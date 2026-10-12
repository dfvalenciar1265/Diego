import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getProperties } from '@/actions/properties'
import { getIncomeReport, getCleaningCostReport, getProfitabilityReport, getCleaningByEmployee } from '@/actions/reports'
import { getExpenses } from '@/actions/expenses'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportsView } from '@/components/reports/ReportsView'
import { todayInBogota } from '@/lib/gpt-api/dates'

export default async function ReportsPage() {
  // Admin-only — cached per request
  const member = await getCurrentMember()
  if (!member) redirect('/logout')
  if (member.role !== 'admin') redirect('/')

  // Month in Colombia time: the server runs in UTC, so from 7 pm on the last day of
  // the month `new Date()` would already open next month's (empty) reports.
  // The active tab (?tab=…) is read on the client by ReportsView via useSearchParams.
  const [currentYear, currentMonth] = todayInBogota().split('-').map(Number)

  const [
    properties,
    incomeRows,
    cleaningCostRows,
    profitabilityRows,
    employeeCleaningRows,
    expenses,
  ] = await Promise.all([
    getProperties(true),
    getIncomeReport(currentYear, currentMonth),
    getCleaningCostReport(currentYear, currentMonth),
    getProfitabilityReport(currentYear, currentMonth),
    getCleaningByEmployee(currentYear, currentMonth),
    getExpenses({ year: currentYear, month: currentMonth }),
  ])

  return (
    <>
      <PageHeader title="Reportes" />
      <ReportsView
        properties={properties}
        incomeRows={incomeRows}
        cleaningCostRows={cleaningCostRows}
        profitabilityRows={profitabilityRows}
        employeeCleaningRows={employeeCleaningRows}
        currentYear={currentYear}
        currentMonth={currentMonth}
        expenses={expenses}
      />
    </>
  )
}
