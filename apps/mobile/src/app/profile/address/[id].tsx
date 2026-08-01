import React from 'react';

import { AddressEditScreen } from '../../../features/profile/AddressEditScreen';

/** `id` is an address uuid, or the literal `new` (NEW_ADDRESS) to create one. */
export default function ProfileAddressRoute() {
  return <AddressEditScreen />;
}
