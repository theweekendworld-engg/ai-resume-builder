import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  
  if (dateStr.includes('/')) {
    const [month, year] = dateStr.split('/');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }
  
  if (dateStr.includes('-') && dateStr.length >= 7) {
    const [year, month] = dateStr.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }
  
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }
  
  return dateStr;
}
