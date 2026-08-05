import React from 'react';

import { AuthGate } from '../../../components/AuthGate';
import { AddressEditScreen } from '../../../features/profile/AddressEditScreen';

/** `id` is an address uuid, or the literal `new` (NEW_ADDRESS) to create one. */
export default function ProfileAddressRoute() {
  return (
    <AuthGate>
      <AddressEditScreen />
    </AuthGate>
  );
}
