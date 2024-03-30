export function abbreviateNumber(number: number): string {
  if (number < 1000) {
    return number.toString();
  }

  if (number === 1000) {
    return "1K";
  }

  return "1K+";
}
