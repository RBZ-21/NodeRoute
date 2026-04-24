import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const CTA = {
  earlyAccess:
    'mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Request%20Early%20Access',
  founder:
    'mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Talk%20to%20the%20Founder',
  login: '/login',
} as const;
