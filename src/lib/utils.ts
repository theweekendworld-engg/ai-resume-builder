import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts markdown-style formatting to HTML
 * Supports: **bold**, *italic*, and preserves existing HTML tags
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';
  
  let html = text;
  
  // Check if text already contains HTML tags - if so, preserve them
  const hasHtmlTags = /<[^>]+>/.test(html);
  
  if (!hasHtmlTags) {
    // Only process markdown if no HTML tags are present
    // Convert markdown bold (**text** or __text__) to HTML <strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Convert markdown italic (*text* but not **text**) to HTML <em>
    // Match single * that are not part of **
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
  }
  
  // Convert newlines to <br> tags (but preserve existing <br> tags)
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

/**
 * Formats date from MM/YYYY or YYYY-MM to "Month YYYY" format
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  
  // Handle MM/YYYY format
  if (dateStr.includes('/')) {
    const [month, year] = dateStr.split('/');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }
  
  // Handle YYYY-MM format
  if (dateStr.includes('-') && dateStr.length >= 7) {
    const [year, month] = dateStr.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }
  
  // If it's just a year (YYYY)
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Return as-is if format is not recognized
  return dateStr;
}

/**
 * Determines if a URL is a GitHub repository link
 */
export function isGitHubUrl(url: string): boolean {
  if (!url) return false;
  const normalizedUrl = url.toLowerCase();
  return normalizedUrl.includes('github.com') || normalizedUrl.includes('github.io');
}

/**
 * Gets the display text for a project URL
 * Returns "[Repo]" for GitHub links, "[Live]" for others
 */
export function getProjectLinkText(url: string): string {
  if (!url) return '';
  return isGitHubUrl(url) ? '[Repo]' : '[Live]';
}
