/**
 * Paystack Payment Service
 *
 * Wraps the Paystack REST API for server-side use (Node.js / Next.js API routes).
 * All monetary amounts are in KOBO (ZAR cents × 100).
 *   R1.00 = 100 kobo
 *   R10,000.00 = 1,000,000 kobo
 *
 * Spec: § 7.5, § 8.1, CLAUDE.md §3.2
 * Paystack API docs: https://paystack.com/docs/api/
 */

import { createHmac } from 'node:crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'
const DEFAULT_COMMISSION_RATE = 0.06 // 6%

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaystackSubaccountData {
  id: number
  subaccount_code: string
  business_name: string
  description: string
  primary_contact_name: string | null
  primary_contact_email: string | null
  primary_contact_phone: string | null
  metadata: Record<string, unknown>
  percentage_charge: number
  settlement_bank: string
  account_number: string
  settlement_schedule: string
  active: boolean
  migrate: boolean
}

export interface PaystackSplitData {
  id: number
  name: string
  split_code: string
  type: 'percentage' | 'flat'
  total_subaccounts: number
  subaccounts: Array<{
    subaccount: { id: number; subaccount_code: string; business_name: string }
    share: number
  }>
  bearer_type: string
  bearer_subaccount: string | null
  currency: string
}

export interface PaystackTransactionInit {
  authorization_url: string
  access_code: string
  reference: string
}

export interface PaystackTransactionVerify {
  id: number
  reference: string
  status: 'success' | 'failed' | 'abandoned' | 'pending'
  amount: number             // kobo
  currency: string
  paid_at: string
  channel: string
  fees: number               // kobo
  customer: { email: string; customer_code: string }
  authorization: { authorization_code: string; card_type: string; last4: string; bank: string }
  metadata: Record<string, unknown>
  split: { amount: number; subaccount: { subaccount_code: string } }[]
}

export interface CommissionBreakdown {
  totalKobo: number
  commissionRate: number
  commissionKobo: number     // E-Site receives — rounded UP (Math.ceil)
  supplierKobo: number       // Supplier receives
  supplierSharePercent: number // e.g. 94 for 6% commission
}

export interface PaystackTransferRecipient {
  recipient_code: string
  id: number
  type: string
  name: string
  account_number: string
  bank_code: string
}

export interface PaystackTransfer {
  id: number
  transfer_code: string
  reference: string
  amount: number    // kobo
  status: string
  recipient: { recipient_code: string }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PaystackService {
  private readonly secretKey: string

  constructor(secretKey: string) {
    if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is required')
    this.secretKey = secretKey
  }

  // ── Internal HTTP helper ──────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    const json = await res.json() as { status: boolean; message: string; data: T }

    if (!res.ok || !json.status) {
      throw new Error(`Paystack API error [${res.status}] ${json.message ?? 'Unknown error'}`)
    }

    return json.data
  }

  // ── Commission calculation ────────────────────────────────────────────────

  /**
   * Calculate commission split for an order.
   * Rounds commission UP (E-Site favour), remainder goes to supplier.
   *
   * @param totalKobo  - Order total in kobo
   * @param rate       - Commission rate, e.g. 0.06 for 6%
   */
  calculateCommission(
    totalKobo: number,
    rate: number = DEFAULT_COMMISSION_RATE,
  ): CommissionBreakdown {
    if (totalKobo < 0) throw new Error('totalKobo must be non-negative')
    if (rate < 0 || rate > 1) throw new Error('rate must be between 0 and 1')

    const commissionKobo = Math.ceil(totalKobo * rate)
    const supplierKobo = totalKobo - commissionKobo
    const supplierSharePercent = Math.floor((supplierKobo / totalKobo) * 100)

    return { totalKobo, commissionRate: rate, commissionKobo, supplierKobo, supplierSharePercent }
  }

  // ── Subaccounts ───────────────────────────────────────────────────────────

  /**
   * Create a Paystack subaccount for a supplier.
   * Called during supplier onboarding (T-034).
   */
  async createSubaccount(params: {
    businessName: string
    settlementBank: string     // SA bank code e.g. '058' (FNB), '007' (Absa)
    accountNumber: string
    percentageCharge: number   // E-Site's cut, e.g. 6
    description?: string
    primaryContactEmail?: string
    primaryContactPhone?: string
    primaryContactName?: string
  }): Promise<PaystackSubaccountData> {
    return this.request<PaystackSubaccountData>('POST', '/subaccount', {
      business_name: params.businessName,
      settlement_bank: params.settlementBank,
      account_number: params.accountNumber,
      percentage_charge: params.percentageCharge,
      description: params.description ?? '',
      primary_contact_email: params.primaryContactEmail,
      primary_contact_phone: params.primaryContactPhone,
      primary_contact_name: params.primaryContactName,
      metadata: { source: 'esite-platform' },
    })
  }

  /**
   * Update a subaccount (e.g. to change bank details or commission rate).
   */
  async updateSubaccount(
    subaccountCode: string,
    params: {
      percentageCharge?: number
      primaryContactEmail?: string
      primaryContactName?: string
    },
  ): Promise<PaystackSubaccountData> {
    return this.request<PaystackSubaccountData>('PUT', `/subaccount/${subaccountCode}`, {
      ...(params.percentageCharge !== undefined && { percentage_charge: params.percentageCharge }),
      ...(params.primaryContactEmail && { primary_contact_email: params.primaryContactEmail }),
      ...(params.primaryContactName && { primary_contact_name: params.primaryContactName }),
    })
  }

  // ── Transaction Splits ────────────────────────────────────────────────────

  /**
   * Create a percentage split code for a supplier.
   * This split code is reused on every transaction with this supplier.
   * Supplier share = 100 - commissionPercent.
   *
   * @param name              - Descriptive name e.g. "Acme Electrical Split"
   * @param supplierSubaccount - Supplier's Paystack subaccount code
   * @param commissionPercent  - E-Site's commission e.g. 6 (supplier gets 94%)
   */
  async createSplit(params: {
    name: string
    supplierSubaccountCode: string
    commissionPercent: number
  }): Promise<PaystackSplitData> {
    const supplierShare = 100 - params.commissionPercent
    return this.request<PaystackSplitData>('POST', '/split', {
      name: params.name,
      type: 'percentage',
      currency: 'ZAR',
      subaccounts: [
        {
          subaccount: params.supplierSubaccountCode,
          share: supplierShare,
        },
      ],
      bearer_type: 'all',       // transaction fees shared proportionally
    })
  }

  /**
   * Update a split (e.g. to change commission rate).
   */
  async updateSplit(
    splitCode: string,
    params: { supplierSubaccountCode: string; commissionPercent: number },
  ): Promise<PaystackSplitData> {
    const supplierShare = 100 - params.commissionPercent
    return this.request<PaystackSplitData>('PUT', `/split/${splitCode}`, {
      subaccounts: [{ subaccount: params.supplierSubaccountCode, share: supplierShare }],
      active: true,
    })
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  /**
   * Initialize a payment transaction (returns checkout URL for contractor).
   * Pass a splitCode to auto-route commission to E-Site and supplier.
   *
   * @param amountKobo   - Total order amount in kobo
   * @param email        - Paying customer's email
   * @param reference    - Unique reference (order ID or generated UUID)
   * @param splitCode    - Paystack split code from createSplit()
   * @param callbackUrl  - Where to redirect after payment
   * @param metadata     - Arbitrary data attached to transaction
   * @param channels     - Payment channels: ['card', 'bank_transfer'] etc.
   */
  async initializeTransaction(params: {
    amountKobo: number
    email: string
    reference: string
    splitCode?: string
    callbackUrl?: string
    metadata?: Record<string, unknown>
    channels?: string[]
  }): Promise<PaystackTransactionInit> {
    return this.request<PaystackTransactionInit>('POST', '/transaction/initialize', {
      amount: params.amountKobo,
      email: params.email,
      reference: params.reference,
      currency: 'ZAR',
      ...(params.splitCode && { split_code: params.splitCode }),
      ...(params.callbackUrl && { callback_url: params.callbackUrl }),
      ...(params.channels && { channels: params.channels }),
      metadata: {
        source: 'esite-marketplace',
        ...(params.metadata ?? {}),
      },
    })
  }

  /**
   * Verify a transaction by reference.
   * Call after Paystack redirects back to callback URL or on webhook.
   */
  async verifyTransaction(reference: string): Promise<PaystackTransactionVerify> {
    return this.request<PaystackTransactionVerify>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    )
  }

  // ── Transfers (manual payouts) ────────────────────────────────────────────

  /**
   * Create a transfer recipient from a bank account.
   * Required before initiating a Transfer.
   */
  async createTransferRecipient(params: {
    name: string
    accountNumber: string
    bankCode: string
    description?: string
  }): Promise<PaystackTransferRecipient> {
    return this.request<PaystackTransferRecipient>('POST', '/transferrecipient', {
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'ZAR',
      description: params.description,
    })
  }

  /**
   * Initiate a transfer payout to a supplier.
   * Use for manual payout scenarios (not needed when using splits, but useful for
   * batch settlement or refunds).
   */
  async initiateTransfer(params: {
    amountKobo: number
    recipientCode: string
    reference: string
    reason?: string
  }): Promise<PaystackTransfer> {
    return this.request<PaystackTransfer>('POST', '/transfer', {
      source: 'balance',
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason ?? 'E-Site marketplace payout',
      currency: 'ZAR',
    })
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Create a Paystack plan for a subscription tier.
   */
  async createPlan(params: {
    name: string
    amountKobo: number
    interval: 'monthly' | 'annually'
    description?: string
  }): Promise<{ id: number; name: string; plan_code: string; amount: number; interval: string }> {
    return this.request('POST', '/plan', {
      name: params.name,
      amount: params.amountKobo,
      interval: params.interval,
      currency: 'ZAR',
      description: params.description,
    })
  }

  /**
   * Create a Paystack customer (required before subscription).
   */
  async createCustomer(params: {
    email: string
    firstName?: string
    lastName?: string
    phone?: string
  }): Promise<{ customer_code: string; email: string; id: number }> {
    return this.request('POST', '/customer', {
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
      phone: params.phone,
    })
  }

  /**
   * List SA banks (for supplier subaccount onboarding form).
   */
  async listSABanks(): Promise<Array<{ id: number; name: string; code: string }>> {
    return this.request('GET', '/bank?country=ZA&currency=ZAR&use_cursor=false&perPage=100')
  }

  // ── Webhook signature verification ───────────────────────────────────────

  /**
   * Verify that a webhook request came from Paystack.
   * Uses HMAC SHA-512 with the Paystack secret key.
   * MUST be called before processing any webhook event.
   *
   * Spec: CLAUDE.md §10 point 9 — "Paystack webhooks use HMAC SHA-512"
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const hash = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex')
    return hash === signature
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: PaystackService | null = null

/**
 * Get a singleton PaystackService instance using the environment variable.
 * Use this in Next.js server components / API routes.
 */
export function getPaystackService(): PaystackService {
  if (!_instance) {
    const key = process.env.PAYSTACK_SECRET_KEY
    if (!key) throw new Error('PAYSTACK_SECRET_KEY environment variable is not set')
    _instance = new PaystackService(key)
  }
  return _instance
}

export { DEFAULT_COMMISSION_RATE }
