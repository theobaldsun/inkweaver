import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthScreen } from './pages/AuthScreen';
import DocumentEditScreen from './pages/DocumentEditScreen';
import { AuthRoute } from './components/AuthRoute';
import { MainTabNavigator } from './components/MainTabNavigator';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  DocumentEdit: { id?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const ProtectedMainTabNavigator: React.FC = () => (
  <AuthRoute>
    <MainTabNavigator />
  </AuthRoute>
);

const ProtectedDocumentEditScreen: React.FC = () => (
  <AuthRoute>
    <DocumentEditScreen />
  </AuthRoute>
);

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Auth"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen 
          name="Main" 
          component={ProtectedMainTabNavigator}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen 
          name="DocumentEdit" 
          component={ProtectedDocumentEditScreen}
          options={{
            headerShown: true,
            title: '编辑文档',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
