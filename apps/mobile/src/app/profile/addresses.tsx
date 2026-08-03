import React from 'react';

import { AuthGate } from '../../components/AuthGate';
import { AddressListScreen } from '../../features/profile/AddressListScreen';

export default function ProfileAddressesRoute() {
  return (
    <AuthGate>
      <AddressListScreen />
    </AuthGate>
  );
}
