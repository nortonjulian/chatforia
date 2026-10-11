import { useUser } from '@/context/UserContext';
import { isPremiumUser } from '@/utils/planAccess';

export default function useIsPremium() {
  const ctx = (typeof useUser === 'function' ? useUser() : null) || null;
  return isPremiumUser(ctx?.currentUser || null);
}
