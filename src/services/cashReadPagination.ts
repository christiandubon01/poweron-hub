/** Complete, stable org-scoped Supabase reads. A short page is the only end marker. */
export async function readCashPages<T>(
  table: string,
  makeQuery: (from: any) => any,
  from: (table: string) => any,
): Promise<T[]> {
  const pageSize = 500
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery(from(table))
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    if (!Array.isArray(data)) throw new Error(`${table} read returned no rows payload`)
    rows.push(...data as T[])
    if (data.length < pageSize) return rows
  }
}
