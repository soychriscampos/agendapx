export const DEPOSIT_RULE_SCOPES = ['ALL', 'APPOINTMENT_TYPE', 'INTAKE_FIELD'] as const
export const DEPOSIT_TYPES = ['PERCENTAGE', 'FIXED'] as const

export type DepositRuleScope = (typeof DEPOSIT_RULE_SCOPES)[number]
export type DepositType = (typeof DEPOSIT_TYPES)[number]

export type DepositRule = {
  id: string
  name: string
  scope: DepositRuleScope
  appointment_type_id: string | null
  intake_field_id: string | null
  operator: 'EQUALS' | null
  condition_value: string | null
  deposit_type: DepositType
  deposit_value: number
  is_active: boolean
  sort_order: number
  created_at?: string
}

export type DepositRuleDraft = Omit<DepositRule, 'deposit_value'> & {
  deposit_value: number | null
}

export function depositRuleSortOrder(index: number) {
  return (index + 1) * 10
}

export function sortDepositRules<T extends Pick<DepositRule, 'id' | 'sort_order'> & { created_at?: string }>(rules: readonly T[]) {
  return [...rules].sort((left, right) =>
    left.sort_order - right.sort_order ||
    (left.created_at ?? '').localeCompare(right.created_at ?? '') ||
    left.id.localeCompare(right.id),
  )
}

export function validateDepositRule(rule: {
  name: string
  scope: string
  appointment_type_id: string | null
  intake_field_id: string | null
  operator: string | null
  condition_value: string | null
  deposit_type: string
  deposit_value: number | null
  sort_order: number
}) {
  const validScope = DEPOSIT_RULE_SCOPES.includes(rule.scope as DepositRuleScope)
  const validType = DEPOSIT_TYPES.includes(rule.deposit_type as DepositType)
  const value = rule.deposit_value
  const validValue = value !== null && Number.isFinite(value) && value > 0 &&
    (rule.deposit_type !== 'PERCENTAGE' || value <= 100)
  const validCondition = rule.scope === 'ALL'
    ? !rule.appointment_type_id && !rule.intake_field_id && !rule.operator && !rule.condition_value
    : rule.scope === 'APPOINTMENT_TYPE'
      ? !!rule.appointment_type_id && !rule.intake_field_id && !rule.operator && !rule.condition_value
      : rule.scope === 'INTAKE_FIELD'
        ? !!rule.intake_field_id && rule.operator === 'EQUALS' && !!rule.condition_value?.trim() && !rule.appointment_type_id
        : false

  if (!rule.name.trim() || !validScope || !validType || !validValue || !validCondition || !Number.isInteger(rule.sort_order) || rule.sort_order <= 0) {
    return 'Completa la regla de anticipo antes de continuar.'
  }

  return null
}
