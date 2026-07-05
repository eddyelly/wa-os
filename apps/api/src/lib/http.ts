/** Express 5 types route params as string | string[]; we always want one. */
export function routeParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  return value?.[0] ?? '';
}
