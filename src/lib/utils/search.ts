export type SearchParamsValue = string | string[] | undefined;

export function getSearchParamValue(value: SearchParamsValue) {
  if (Array.isArray(value)) return value[0];
  return value;
}
