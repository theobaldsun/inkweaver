/**
 * Mobile 端平台适配器
 */

import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import type { ButtonProps as UIButtonProps, InputProps as UIInputProps, CheckboxProps as UICheckboxProps, CardProps as UICardProps } from '@inkweaver/ui';

interface ButtonProps extends Omit<UIButtonProps, 'style'> {
  style?: any;
}

interface InputProps extends Omit<UIInputProps, 'style'> {
  style?: any;
}

interface CheckboxProps extends Omit<UICheckboxProps, 'style'> {
  style?: any;
}

interface CardProps extends Omit<UICardProps, 'style'> {
  style?: any;
}

// Mobile 端 Button 实现
const Button: React.FC<ButtonProps> = ({ variant = 'primary', onPress, disabled, children, className, style }) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        style
      ]}
    >
      <Text style={[
        styles.buttonText,
        variant === 'primary' ? styles.buttonTextPrimary : styles.buttonTextSecondary
      ]}>
        {children}
      </Text>
    </TouchableOpacity>
  );
};

// Mobile 端 Input 实现
const Input: React.FC<InputProps> = ({ value, onChange, placeholder, type = 'text', disabled, className, style, required, minLength }) => {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      editable={!disabled}
      secureTextEntry={type === 'password'}
      keyboardType={type === 'email' ? 'email-address' : 'default'}
      autoCapitalize={type === 'email' ? 'none' : 'sentences'}
      style={[
        styles.input,
        disabled && styles.inputDisabled,
        style
      ]}
    />
  );
};

// Mobile 端 Checkbox 实现
const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, label, disabled, className, style }) => {
  return (
    <TouchableOpacity
      style={[styles.checkboxContainer, style]}
      onPress={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <View style={[
        styles.checkbox,
        checked && styles.checkboxChecked,
        disabled && styles.checkboxDisabled
      ]}>
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      {label && (
        <Text style={[
          styles.checkboxLabel,
          disabled && styles.checkboxLabelDisabled
        ]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
};

// Mobile 端 Card 实现
const Card: React.FC<CardProps> = ({ children, className, style }) => {
  return (
    <View style={[
      styles.card,
      style
    ]}>
      {children}
    </View>
  );
};

// 样式
const styles = StyleSheet.create({
  // Button 样式
  button: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#4a90e2',
  },
  buttonSecondary: {
    backgroundColor: '#f5f5f5',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  buttonTextPrimary: {
    color: 'white',
  },
  buttonTextSecondary: {
    color: '#333',
  },
  
  // Input 样式
  input: {
    width: '100%',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    fontSize: 16,
    backgroundColor: 'white',
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
  },
  
  // Checkbox 样式
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 4,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
  },
  checkboxChecked: {
    backgroundColor: '#4a90e2',
    borderColor: '#4a90e2',
  },
  checkboxDisabled: {
    opacity: 0.6,
  },
  checkmark: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#666',
  },
  checkboxLabelDisabled: {
    opacity: 0.6,
  },
  
  // Card 样式
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});

// Mobile 端平台适配器
export const platformAdapter = {
  Button,
  Input,
  Checkbox,
  Card
};
