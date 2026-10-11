import { useUser } from '@/context/UserContext';
import { isPaidPlanUser } from '@/utils/planAccess';

export default function useIsPaidPlan() {
  const ctx = (typeof useUser === 'function' ? useUser() : null) || null;
  return isPaidPlanUser(ctx?.currentUser || null);
}
