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
  it('claims success only after a usable branch confirmation',()=>{for(const s of ALL)expect(confirmationPresentation(s).success,s).toBe(s==='confirmed_by_branch');});
  // The number card is shown when a POS number is present OR still expected.
  // It must stay hidden on a channel with no POS step, which will never issue
  // one — promising it there is the delivery-confirmation copy bug.
  it('shows the branch-number card only where a number can exist',()=>{const numbered=new Set<CustomerOrderState>(['sending_to_branch','confirmed_by_branch','verifying_with_branch']);for(const s of ALL)expect(confirmationPresentation(s).showBranchNumber,s).toBe(numbered.has(s));});
  it('never promises a branch number on a channel with no POS step',()=>{for(const s of ['accepted_no_pos_channel','accepted_no_pos_channel_unpaid'] as CustomerOrderState[])expect(confirmationPresentation(s).showBranchNumber,s).toBe(false);});
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
  // SM-2026-000070 was synced as ticket #2 in 7.30 s with zero failed attempts,
  // and its customer was still shown "we could not verify whether the branch
  // received this order". pos_create_attempted_at is written IMMEDIATELY BEFORE
  // the POST leaves, so every in-flight order carries it; testing the marker
  // ahead of `syncing` made the alarming copy the default for any order checkout
  // returned on mid-send. The number is still expected, so the card stays.
  it('calls an in-flight send "sending", not "could not verify"',()=>{const state=deriveCustomerOrderState(paid({syncState:'syncing',posCreateAttemptedAt:past()}));expect(state).toBe('sending_to_branch');const p=confirmationPresentation(state);expect(p.canResend).toBe(false);expect(p.tone).toBe('info');expect(p.showBranchNumber).toBe(true);});
  // A syncing row that already holds a ref is genuinely ambiguous, so `ref` must
  // stay AHEAD of the in-flight check.
  it('still verifies a syncing row that already holds a ref',()=>{expect(deriveCustomerOrderState(paid({syncState:'syncing',ref:'#5',posCreateAttemptedAt:past()}))).toBe('verifying_with_branch');});
  // And the marker is still ambiguous once the send is OVER — it outlived it.
  it('still verifies a marker that outlived its send',()=>{for(const s of['pending','failed','dead_letter'])expect(deriveCustomerOrderState(paid({syncState:s,posCreateAttemptedAt:past()})),s).toBe('verifying_with_branch');});
  it('confirms only synced + usable ref',()=>{expect(deriveCustomerOrderState(paid({syncState:'synced',ref:'#42'}))).toBe('confirmed_by_branch');expect(deriveCustomerOrderState(paid({syncState:'synced',ref:null}))).toBe('verifying_with_branch');});
  it('keeps unpaid online behind payment gate',()=>{expect(deriveCustomerOrderState(paid({paymentStatus:'pending'}))).toBe('payment_pending');});
  it('keeps non-POS delivery neutral',()=>{expect(deriveCustomerOrderState(paid({orderType:'delivery',syncState:'blocked',blockedReason:'delivery_schema_unconfirmed',customerRetryCount:9}))).toBe('accepted_no_pos_channel');expect(deriveCustomerOrderState(cash({orderType:'delivery',syncState:'blocked',blockedReason:'delivery_schema_unconfirmed'}))).toBe('accepted_no_pos_channel_unpaid');});
});

describe('refund lifecycle and adapter',()=>{
  it('reports provider-confirmed refund states honestly',()=>{expect(deriveCustomerOrderState(paid({refundState:'processing'}))).toBe('final_failure_refund_pending');expect(deriveCustomerOrderState(paid({refundState:'refunded'}))).toBe('final_failure_refunded');expect(deriveCustomerOrderState(paid({refundState:'failed'}))).toBe('final_failure_refund_failed');});
  it('maps Order-shaped fields',()=>{expect(orderConfirmationState({orderType:'pickup',paymentMethod:'online',paymentStatus:'paid',lazywaitSyncState:'synced',lazywaitRef:'#7',syncBlockedReason:null,syncNextAttemptAt:null,posCreateAttemptedAt:null,posCustomerRetryCount:0,refundState:'none'})).toBe('confirmed_by_branch');});
});
