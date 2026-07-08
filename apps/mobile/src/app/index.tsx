/** Entry route: wait for the session check, then send to tabs or login. */
import { Redirect } from 'expo-router';
import React from 'react';

import { LoadingView } from '../components/StateViews';
import { Screen } from '../components/Screen';
import { useAuth } from '../store';

export default function Index() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  return <Redirect href={status === 'signed_in' ? '/(tabs)' : '/(auth)/login'} />;
}
