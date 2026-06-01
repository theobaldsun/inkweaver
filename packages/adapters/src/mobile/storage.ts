/**
 * React Native端存储适配器
 * 使用AsyncStorage实现StorageAdapter接口
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StorageAdapter } from '@inkweaver/api';

/**
 * React Native端AsyncStorage适配器
 */
export const mobileStorageAdapter: StorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error('Error getting item from AsyncStorage:', error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Error setting item to AsyncStorage:', error);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing item from AsyncStorage:', error);
    }
  },
};

export default mobileStorageAdapter;