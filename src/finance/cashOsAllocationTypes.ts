export interface CashOsBucket {
  id: string
  organizationId: string
  name: string
  description: string | null
  color: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface CashOsEnvelope {
  id: string
  organizationId: string
  bucketId: string | null
  name: string
  description: string | null
  targetAmountMinor: number | null
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface CashOsEnvelopeEntry {
  id: string
  organizationId: string
  envelopeId: string
  amountMinor: number
  direction: 'allocate' | 'release'
  note: string | null
  createdAt: string
}

export interface CashOsEnvelopeBalance {
  envelopeId: string
  allocatedMinor: number
  releasedMinor: number
  balanceMinor: number
}
