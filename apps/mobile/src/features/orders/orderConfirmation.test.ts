import { describe, expect, it } from 'vitest';
import { CUSTOMER_RESEND_LIMIT, confirmationPresentation, deriveCustomerOrderState, hasUsablePosRef, orderConfirmationState, posConfirmationChannelActive, type CustomerOrderState, type OrderConfirmationInput } from './orderConfirmation';

const past=()=>new Date(Date.now()-60_000).toISOString();
const future=()=>new Date(Date.now()+60_000).toISOString();
const ALL:CustomerOrderState[]=['payment_pending','accepted_no_pos_channel','accepted_no_pos_channel_unpaid','sending_to_branch','confirmed_by_branch','verifying_with_branch','branch_failed_retry_available','unpaid_branch_failed_retry_available','final_failure_refund_pending','final_failure_refunded','final_failure_refund_failed','unpaid_final_failure'];
function paid(over:Partial<OrderConfirmationInput>={}):OrderConfirmationInput{return{orderType:'pickup',paymentMethod:'online',paymentStatus:'paid',syncState:'pending',ref:null,blockedReason:null,nextAttemptAt:null,posCreateAttemptedAt:null,customerRetryCount:0,refundState:'none',...over};}
function cash(over:Partial<OrderConfirmationInput>={}):OrderConfirmationInput{return paid({paymentMethod:'cash',paymentStatus:'pending',...over});}

describe('reference and channel safety',()=>{
  it('accepts only a trimmed non-empty POS ref',()=>{expect(hasUsablePosRef('#12')).toBe(true);for(const v of[null,undefined,'','   ','\t\n',12,{},[]])expect(hasUsablePosRef(v)).toBe(false);});
  it('excludes only channels with no POS step',()=>{expect(posConfirmationChannelActive('blocked','delivery_schema_unconfirmed')).toBe(false);expect(posConfirmationChannelActive('skipped',null)).toBe(false);expect(posConfirmationChannelActive(null,null)).toBe(false);expect(posConfirmationChannelActive('blocked','invalid_license')).toBe(true);expect(posConfirmationChannelActive('pending',null)).toBe(true);});
});

describe('presentation invariants',()=>{
  it('shows success and branch number only after a usable branch confirmation',()=>{for(const s of ALL){expect(confirmationPresentation(s).success,s).toBe(s==='confirmed_by_branch');expect(confirmationPresentation(s).showBranchNumber,s).toBe(s==='confirmed_by_branch');}});
  it('offers resend only from proven-not-sent states',()=>{const resendable=new Set<CustomerOrderState>(['branch_failed_retry_available','unpaid_branch_failed_retry_available']);for(const s of ALL)expect(confirmationPresentation(s).canResend,s).toBe(resendable.has(s));});
});

describe('manual-resend-only state derivation',()=>{
  it('keeps only the current pending/syncing attempt in sending state',()=>{expect(deriveCustomerOrderState(paid({syncState:'pending'}))).toBe('sending_to_branch');expect(deriveCustomerOrderState(paid({syncState:'syncing'}))).toBe('sending_to_branch');});
  it('never treats a failed row as an automatic retry, even with a legacy future timestamp',()=>{expect(deriveCustomerOrderState(paid({syncState:'failed',nextAttemptAt:future()}))).toBe('branch_failed_retry_available');expect(deriveCustomerOrderState(cash({syncState:'failed',nextAttemptAt:future()}))).toBe('unpaid_branch_failed_retry_available');});
  it('offers manual resend immediately after proven failure',()=>{expect(deriveCustomerOrderState(paid({syncState:'failed'}))).toBe('branch_failed_retry_available');expect(deriveCustomerOrderState(paid({syncState:'dead_letter'}))).toBe('branch_failed_retry_available');});
  it('moves to final outcome at the customer resend limit',()=>{expect(deriveCustomerOrderState(paid({syncState:'failed',customerRetryCount:CUSTOMER_RESEND_LIMIT}))).toBe('final_failure_refund_pending');expect(deriveCustomerOrderState(cash({syncState:'failed',customerRetryCount:CUSTOMER_RESEND_LIMIT}))).toBe('unpaid_final_failure');});
});

describe('ambiguity and payment gates',()=>{
  it('never resends a may-have-been-sent order',()=>{for(const input of[paid({syncState:'confirmation_required'}),paid({syncState:'synced',ref:''}),paid({syncState:'dead_letter',ref:'  '}),paid({syncState:'dead_letter',posCreateAttemptedAt:past()})]){const state=deriveCustomerOrderState(input);expect(state).toBe('verifying_with_branch');expect(confirmationPresentation(state).canResend).toBe(false);}});
  it('confirms only synced + usable ref',()=>{expect(deriveCustomerOrderState(paid({syncState:'synced',ref:'#42'}))).toBe('confirmed_by_branch');expect(deriveCustomerOrderState(paid({syncState:'synced',ref:null}))).toBe('verifying_with_branch');});
  it('keeps unpaid online behind payment gate',()=>{expect(deriveCustomerOrderState(paid({paymentStatus:'pending'}))).toBe('payment_pending');});
  it('keeps non-POS delivery neutral',()=>{expect(deriveCustomerOrderState(paid({orderType:'delivery',syncState:'blocked',blockedReason:'delivery_schema_unconfirmed',customerRetryCount:9}))).toBe('accepted_no_pos_channel');expect(deriveCustomerOrderState(cash({orderType:'delivery',syncState:'blocked',blockedReason:'delivery_schema_unconfirmed'}))).toBe('accepted_no_pos_channel_unpaid');});
});

describe('refund lifecycle and adapter',()=>{
  it('reports provider-confirmed refund states honestly',()=>{expect(deriveCustomerOrderState(paid({refundState:'processing'}))).toBe('final_failure_refund_pending');expect(deriveCustomerOrderState(paid({refundState:'refunded'}))).toBe('final_failure_refunded');expect(deriveCustomerOrderState(paid({refundState:'failed'}))).toBe('final_failure_refund_failed');});
  it('maps Order-shaped fields',()=>{expect(orderConfirmationState({orderType:'pickup',paymentMethod:'online',paymentStatus:'paid',lazywaitSyncState:'synced',lazywaitRef:'#7',syncBlockedReason:null,syncNextAttemptAt:null,posCreateAttemptedAt:null,posCustomerRetryCount:0,refundState:'none'})).toBe('confirmed_by_branch');});
});
