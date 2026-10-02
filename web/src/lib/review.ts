import type { Claim } from './content';

export type OwnerReview = {
  status: 'pending' | 'in_progress' | 'reviewed' | 'stale';
  acceptedClaims: Record<string, { reason: string; accepted_at: string }>;
  reviewedAt?: string;
};

export const ownerReviewLabels: Record<OwnerReview['status'], string> = {
  pending: 'Belum ditinjau pemilik', in_progress: 'Tinjauan pemilik berlangsung',
  reviewed: 'Ditinjau pemilik', stale: 'Tinjauan pemilik perlu diulang',
};

export function parseOwnerReview(metadata: Record<string, any> | undefined, current: boolean, blockIds: string[]): OwnerReview {
  const pending: OwnerReview = { status: 'pending', acceptedClaims: {} };
  const stale: OwnerReview = { status: 'stale', acceptedClaims: {} };
  const review = metadata?.owner_review;
  const human = metadata?.human_review === undefined ? 'pending' : metadata.human_review;
  if (review === undefined) return human === 'pending' ? pending : stale;
  const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
  const date = (value: any) => typeof value === 'string' && /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (!current || !object(review) || !['pending', 'reviewed'].includes(human) ||
      !['summary_hash', 'transcript_hash', 'checked_at'].every(key => typeof review[key] === 'string' && review[key] === metadata?.[key]) ||
      !date(review.checked_at) || !object(review.accepted_claims)) return stale;
  const claims: Record<string, Claim> = metadata!.claims;
  if (blockIds.length !== Object.keys(claims).length || new Set(blockIds).size !== blockIds.length ||
      !blockIds.every(id => Object.hasOwn(claims, id) && claims[id].check && date(claims[id].check!.checked_at) &&
        typeof claims[id].check!.model === 'string' && claims[id].check!.model.trim() &&
        (claims[id].kind === 'quotation'
          ? claims[id].check!.confidence === null && claims[id].check!.verdict === 'supports' && claims[id].check!.model === 'exact-source-copy'
          : claims[id].check!.confidence !== null))) return stale;
  if (!Object.entries(review.accepted_claims).every(([id, value]: [string, any]) => Object.hasOwn(claims, id) && needsReview(claims[id]) &&
      object(value) && typeof value.reason === 'string' && value.reason.trim() && date(value.accepted_at))) return stale;
  if (human === 'reviewed') {
    if (!date(review.reviewed_at) || Object.entries(claims).some(([id, claim]) => needsReview(claim) && !Object.hasOwn(review.accepted_claims, id))) return stale;
    return { status: 'reviewed', acceptedClaims: review.accepted_claims, reviewedAt: review.reviewed_at };
  }
  if (review.reviewed_at !== null) return stale;
  return { status: Object.keys(review.accepted_claims).length ? 'in_progress' : 'pending', acceptedClaims: review.accepted_claims };
}

export function claimStatus(claim?: Claim): string {
  if (!claim?.check) return 'Belum diperiksa';
  const { verdict, confidence } = claim.check;
  if (verdict === 'supports' && (confidence === null || confidence >= .8)) return confidence === null ? 'Kutipan sumber identik' : 'Didukung sumber';
  if ((confidence ?? 0) >= .8 && verdict === 'contradicts') return 'Bertentangan dengan sumber';
  if ((confidence ?? 0) >= .8 && verdict === 'insufficient') return 'Kutipan belum cukup';
  return 'Perlu ditinjau';
}

export function needsReview(claim?: Claim): boolean {
  return !claim?.check || claim.check.verdict !== 'supports' || (claim.check.confidence !== null && claim.check.confidence < .8);
}
