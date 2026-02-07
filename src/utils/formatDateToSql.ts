// Utility to convert DD/MM/YYYY or D/M/YYYY → YYYY-MM-DD
export function formatDateToMySQL(dateStr:string) {
  if (!dateStr) return null;

  // Handle both 27/9/2025 and 27-9-2025
  const parts = dateStr.includes('/') ? dateStr.split('/') : dateStr.split('-');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if(month==undefined||day ==undefined) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

