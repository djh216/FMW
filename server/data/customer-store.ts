import type {
  Customer,
  CustomerListItem,
  CustomerUploadSummary,
  ManualOrderInput,
  Order,
  OrderSelectionInput,
} from "../../shared/types.js";
import { parseCustomersCsv } from "./csv-parser.js";
import {
  cycleNumberFromId,
  getTerritoryDisplayName,
  resolveCycleId,
  resolveTerritoryInput,
} from "./territories.js";
import { defaultApprovedAt } from "../routing/scheduling.js";
import { MIN_ORDER_CASES } from "../../shared/constants.js";
import { normalizeContactFields } from "../../shared/contactFormat.js";
import { resolveCoordinates } from "./geocoder.js";

let customers: Customer[] = [];
let orders: Order[] = [];
let uploadSummary: CustomerUploadSummary | null = null;
let suggestedCases: Record<string, number> = {};
let suggestedCycles: Record<string, number> = {};
let awaitingOrderSelection = false;
let fromCsvUpload = false;

export function isFromCsvUpload(): boolean {
  return fromCsvUpload;
}

export function getCustomers(): Customer[] {
  return customers;
}

export function getOrders(): Order[] {
  return orders;
}

export function getCustomerById(id: string): Customer | undefined {
  return customers.find((c) => c.id === id);
}

export function getUploadSummary(): CustomerUploadSummary | null {
  return uploadSummary;
}

export function isAwaitingOrderSelection(): boolean {
  return awaitingOrderSelection;
}

export function getCustomerListItems(): CustomerListItem[] {
  if (customers.length === 0) return [];

  const orderByCustomer = new Map(orders.map((o) => [o.customerId, o]));

  return customers.map((c) => {
    const existing = orderByCustomer.get(c.id);
    const suggested = suggestedCases[c.id];
    const hasOrder = !!existing;
    const cases = existing?.cases ?? suggested ?? 0;
    const cycle = existing
      ? cycleNumberFromId(existing.cycleId)
      : suggestedCycles[c.id];

    return {
      ...c,
      territoryName: getTerritoryDisplayName(c.territoryId),
      hasOrder,
      cases,
      cycle,
    };
  });
}

export async function importWeeklyCustomersCsv(
  csvText: string,
  referenceDate: Date,
  filename?: string
): Promise<CustomerUploadSummary> {
  const result = await parseCustomersCsv(csvText, referenceDate);

  if (result.errors.length > 0) {
    uploadSummary = {
      uploadedAt: new Date().toISOString(),
      customerCount: 0,
      orderCount: 0,
      filename,
      errors: result.errors,
      warnings: result.warnings,
      awaitingOrderSelection: false,
    };
    return uploadSummary;
  }

  customers = result.customers;
  orders = [];
  suggestedCases = result.suggestedCases;
  suggestedCycles = result.suggestedCycles;
  awaitingOrderSelection = customers.length > 0;
  fromCsvUpload = true;

  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: 0,
    filename,
    errors: [],
    warnings: result.warnings,
    awaitingOrderSelection: true,
    fromCsvUpload: true,
  };

  return uploadSummary;
}

function slugifyCustomerId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "customer";
}

function uniqueCustomerId(name: string): string {
  let id = slugifyCustomerId(name);
  let n = 1;
  while (customers.some((c) => c.id === id)) {
    id = `${slugifyCustomerId(name)}-${n++}`;
  }
  return id;
}

export async function addManualOrder(
  input: ManualOrderInput,
  referenceDate: Date
): Promise<CustomerUploadSummary> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const restaurantName = input.restaurantName?.trim() ?? "";
  const address = input.address?.trim() ?? "";
  const city = input.city?.trim() ?? "";
  const deliveryInstructions = input.deliveryInstructions?.trim() ?? "";

  if (!restaurantName) errors.push("Restaurant name is required");
  if (!address) errors.push("Street address is required");
  if (!city) errors.push("City is required");

  const territoryId = resolveTerritoryInput(input.territoryId ?? "");
  if (!territoryId) {
    errors.push(`Unknown territory: ${input.territoryId || "(empty)"}`);
  }

  const { contactName, contactPhone } = normalizeContactFields(
    input.contactName?.trim() ?? "",
    input.contactPhone?.trim() ?? ""
  );
  if (!contactName) warnings.push("Contact name is missing");
  if (!contactPhone) warnings.push("Phone number is missing or could not be parsed");

  if (errors.length > 0) {
    return {
      uploadedAt: new Date().toISOString(),
      customerCount: customers.length,
      orderCount: orders.length,
      filename: uploadSummary?.filename,
      errors,
      warnings,
      awaitingOrderSelection: awaitingOrderSelection,
      fromCsvUpload: fromCsvUpload || customers.length > 0,
    };
  }

  const coords = await resolveCoordinates(address, city, territoryId!, restaurantName);
  if (!coords.geocoded) {
    warnings.push(
      `${restaurantName}: address not found — using approximate territory location`
    );
  }

  const id = uniqueCustomerId(restaurantName);
  const customer: Customer = {
    id,
    name: restaurantName,
    address,
    city,
    territoryId: territoryId!,
    lat: coords.lat,
    lng: coords.lng,
    contactName,
    contactPhone,
    deliveryInstructions,
  };

  customers.push(customer);

  let cycleId: string;
  try {
    cycleId = resolveCycleId(territoryId!, input.cycle ?? 1);
  } catch {
    return {
      uploadedAt: new Date().toISOString(),
      customerCount: customers.length,
      orderCount: orders.length,
      filename: uploadSummary?.filename,
      errors: [`Could not assign delivery cycle for ${restaurantName}`],
      warnings,
      awaitingOrderSelection: false,
      fromCsvUpload: true,
    };
  }

  orders.push({
    id: `order-${customer.id}-${Date.now()}`,
    customerId: customer.id,
    territoryId: customer.territoryId,
    cycleId,
    cases: MIN_ORDER_CASES,
    approvedAt: defaultApprovedAt(cycleId, referenceDate),
    status: "approved",
  });

  fromCsvUpload = true;
  awaitingOrderSelection = false;

  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors: [],
    warnings,
    awaitingOrderSelection: false,
    fromCsvUpload: true,
  };

  return uploadSummary;
}

export function applyOrderSelection(
  selections: OrderSelectionInput[],
  referenceDate: Date
): CustomerUploadSummary {
  const errors: string[] = [];
  orders = [];

  selections.forEach((sel, idx) => {
    if (sel.cases < MIN_ORDER_CASES) {
      if (sel.cases > 0) {
        const customer = getCustomerById(sel.customerId);
        errors.push(
          `Minimum order is ${MIN_ORDER_CASES} cases (${customer?.name ?? sel.customerId})`
        );
      }
      return;
    }
    const customer = getCustomerById(sel.customerId);
    if (!customer) {
      errors.push(`Unknown customer: ${sel.customerId}`);
      return;
    }
    try {
      const cycleId = resolveCycleId(customer.territoryId, sel.cycle ?? 1);
      orders.push({
        id: `order-${customer.id}-${idx}`,
        customerId: customer.id,
        territoryId: customer.territoryId,
        cycleId,
        cases: sel.cases,
        approvedAt: defaultApprovedAt(cycleId, referenceDate),
        status: "approved",
      });
    } catch {
      errors.push(`Could not assign cycle for ${customer.name}`);
    }
  });

  awaitingOrderSelection = false;

  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors,
    warnings: [],
    awaitingOrderSelection: false,
    fromCsvUpload: true,
  };

  return uploadSummary;
}

export function clearCustomerData(): CustomerUploadSummary {
  customers = [];
  orders = [];
  suggestedCases = {};
  suggestedCycles = {};
  awaitingOrderSelection = false;
  fromCsvUpload = false;
  uploadSummary = null;
  return {
    uploadedAt: new Date().toISOString(),
    customerCount: 0,
    orderCount: 0,
    errors: [],
    warnings: [],
    awaitingOrderSelection: false,
    fromCsvUpload: false,
  };
}

/** Seeds the in-memory store for unit tests only. */
export function seedCustomerStoreForTests(testCustomers: Customer[], testOrders: Order[]): void {
  customers = [...testCustomers];
  orders = [...testOrders];
  suggestedCases = {};
  suggestedCycles = {};
  awaitingOrderSelection = false;
  fromCsvUpload = false;
  uploadSummary = null;
}
