import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { NoteListScreen } from '../pages/NoteListScreen';
import { SearchScreen } from '../pages/SearchScreen';
import { ProfileScreen } from '../pages/ProfileScreen';
import { AuthRoute } from '../components/AuthRoute';
import { FileText, Search, User } from 'lucide-react-native';

export type MainTabParamList = {
  Notes: undefined;
  Search: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const ProtectedNoteListScreen: React.FC = () => (
  <AuthRoute>
    <NoteListScreen />
  </AuthRoute>
);

const ProtectedSearchScreen: React.FC = () => (
  <AuthRoute>
    <SearchScreen />
  </AuthRoute>
);

const ProtectedProfileScreen: React.FC = () => (
  <AuthRoute>
    <ProfileScreen />
  </AuthRoute>
);

export const MainTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const iconSize = focused ? 24 : 22;
          if (route.name === 'Notes') {
            return <FileText size={iconSize} color={color} />;
          } else if (route.name === 'Search') {
            return <Search size={iconSize} color={color} />;
          } else if (route.name === 'Profile') {
            return <User size={iconSize} color={color} />;
          }
          return null;
        },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 20,
          elevation: 10,
          paddingBottom: Platform.OS === 'ios' ? 20 : 5,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 80 : 70,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen 
        name="Notes" 
        component={ProtectedNoteListScreen}
        options={{
          title: '笔记',
        }}
      />
      <Tab.Screen 
        name="Search" 
        component={ProtectedSearchScreen}
        options={{
          title: '搜索',
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProtectedProfileScreen}
        options={{
          title: '我的',
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
});
