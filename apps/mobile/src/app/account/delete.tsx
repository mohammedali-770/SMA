import { AuthGate } from '../../components/AuthGate';
import { DeleteAccountScreen } from '../../features/account/DeleteAccountScreen';

export default function DeleteAccountRoute() {
  return (
    <AuthGate>
      <DeleteAccountScreen />
    </AuthGate>
  );
}
