-- Remove the zero-balance wallet created by the deployment readiness probe.
-- The predicates deliberately prevent deletion if the wallet has since been used.
DELETE FROM public.members AS member
WHERE member.guest_token = '00000000000000000000000000000000'
  AND member.imported_from = 'guest_wallet'
  AND member.current_points = 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.member_point_ledger AS ledger
    WHERE ledger.member_id = member.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.loyalty_claim_tokens AS claim
    WHERE claim.member_id = member.id
  );
