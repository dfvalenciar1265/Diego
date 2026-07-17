import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getProperties } from '@/actions/properties'
import { getIncomeReport, getCleaningCostReport, getProfitabilityReport, getCleaningByEmployee } from '@/actions/reports'
import { getExpenses } from '@/actions/expenses'
import { PageHeader } from '@/components/layout/PageHeader'
import { ReportsView } from '@/components/reports/ReportsView'

export default async function ReportsPage() {
  // Admin-only — cached per request
  const member = await getCurrentMember()
  if (!member) redirect('/login')
  if (member.role !== 'admin') redirect('/')

  const now          = new Date()
  const currentYear  = now.getFullYear()
  const currentMonth = now.getMonth() + 1

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
