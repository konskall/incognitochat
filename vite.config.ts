
// Manually define Vite env types to fix "Cannot find type definition file" error
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Declare modules loaded via CDN (Import Maps) that don't have local type definitions
declare module 'sonner' {
  import * as React from 'react';

  export interface ToasterProps {
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
    hotkey?: string[];
    richColors?: boolean;
    expand?: boolean;
    duration?: number;
    gap?: number;
    visibleToasts?: number;
    closeButton?: boolean;
    toastOptions?: {
        style?: React.CSSProperties;
        className?: string;
        descriptionClassName?: string;
    };
    className?: string;
    style?: React.CSSProperties;
    offset?: string | number;
    theme?: 'light' | 'dark' | 'system';
    dir?: 'rtl' | 'ltr' | 'auto';
  }

  export const Toaster: React.FC<ToasterProps>;

  export interface ToastT {
    id: string | number;
    title?: string | React.ReactNode;
    type?: 'normal' | 'action' | 'success' | 'info' | 'warning' | 'error' | 'loading';
    icon?: React.ReactNode;
    jsx?: React.ReactNode;
    invert?: boolean;
    dismissible?: boolean;
    description?: React.ReactNode;
    duration?: number;
    delete?: boolean;
    important?: boolean;
    action?: {
      label: string;
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    };
    cancel?: {
      label: string;
      onClick?: () => void;
    };
    onDismiss?: (toast: ToastT) => void;
    onAutoClose?: (toast: ToastT) => void;
    promise?: Promise<any>;
    style?: React.CSSProperties;
    className?: string;
    descriptionClassName?: string;
  }

  export interface ToastOptions {
    description?: React.ReactNode;
    duration?: number;
    id?: string | number;
    style?: React.CSSProperties;
    className?: string;
    icon?: React.ReactNode;
    onDismiss?: (toast: ToastT) => void;
    onAutoClose?: (toast: ToastT) => void;
  }

  export const toast: {
    (message: string | React.ReactNode, options?: ToastOptions): string | number;
    message: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    success: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    error: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    info: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    warning: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    loading: (message: string | React.ReactNode, options?: ToastOptions) => string | number;
    dismiss: (id?: string | number) => void;
    promise: <T>(
      promise: Promise<T> | (() => Promise<T>),
      data: {
        loading: string | React.ReactNode;
        success: string | React.ReactNode | ((data: T) => string | React.ReactNode);
        error: string | React.ReactNode | ((error: any) => string | React.ReactNode);
        finally?: () => void;
      },
      options?: ToastOptions
    ) => string | number;
    custom: (jsx: (id: number | string) => React.ReactNode, options?: ToastOptions) => string | number;
  };
}
