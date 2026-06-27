/**
 * Shared chart-data shapes for built-in reports.
 *
 * Most pie/bar reports (spending-by-category, spending-by-payee,
 * income-by-source) feed Recharts a list of `{ name, value }` objects with
 * an optional id (for click-through links) and colour (for slice fills).
 * Reports that need extra columns (e.g. a `colour` palette assigned per
 * slice) extend this base type rather than redefining the shape.
 */
export interface ChartDatum {
  id?: string;
  name: string;
  value: number;
  colour?: string;
}
