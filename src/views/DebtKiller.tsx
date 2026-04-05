// @ts-nocheck
import { useState, useMemo } from 'react';
import {
  Flame,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Plus,
  Trash2,
  CreditCard,
  Calendar,
  Target,
} from 'lucide-react';
import type { Expense, DebtItem, ExpenseCategory } from '../types';
import { mockExpenses, mockDebts, mockMonthlyIncome } from '../mock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMonthlyAmount(expense: Expense): number {
  if (expense.frequency === 'weekly') return expense.amount * 52 / 12;
  if (expense.frequency === 'annual') return expense.amount / 12;
  return expense.amount;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtDecimal(n: number): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Avalanche payoff calculation for a single debt.
 * Returns number of months to pay off. Returns Infinity if cannot pay off. */
function calcPayoffMonths(balance: number, monthlyRate: number, payment: number): number {
  if (payment <= 0) return Infinity;
  if (monthlyRate === 0) {
    return Math.ceil(balance / payment);
  }
  const r = monthlyRate;
  // months = -ln(1 - r*B/P) / ln(1+r)
  const val = 1 - (r * balance) / payment;
  if (val <= 0) return Infinity;
  return Math.ceil(-Math.log(val) / Math.log(1 + r));
}

function addMonths(months: number): string {
  if (!isFinite(months)) return 'Never';
  const d = new Date(2026, 3, 1); // April 2026 baseline
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString('en', { month: 'short', year: 'numeric' });
}

// ─── Category Badge ───────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<ExpenseCategory, string> = {
  housing: 'bg-blue-900/40 text-blue-300 border border-blue-800/60',
  transport: 'bg-orange-900/40 text-orange-300 border border-orange-800/60',
  food: 'bg-green-900/40 text-green-300 border border-green-800/60',
  business: 'bg-purple-900/40 text-purple-300 border border-purple-800/60',
  other: 'bg-gray-800/60 text-gray-400 border border-gray-700/60',
};

function CategoryBadge({ category }: { category: ExpenseCategory }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${CATEGORY_STYLES[category]}`}>
      {category}
    </span>
  );
}

// ─── Panel Wrapper ────────────────────────────────────────────────────────────

function Panel({ title, icon, children, headerRight }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{ borderColor: '#1e2128', backgroundColor: '#0d0e14' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: '#1e2128', backgroundColor: '#0a0b10' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-orange-400">{icon}</span>
          <span className="text-sm font-semibold text-gray-100 uppercase tracking-widest">{title}</span>
        </div>
        {headerRight && <div>{headerRight}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Section 1: Monthly Burn Rate ─────────────────────────────────────────────

function BurnRateSection({ expenses }: { expenses: Expense[] }) {
  // Replace with real Supabase query during integration
  const [income, setIncome] = useState<number>(mockMonthlyIncome);
  const [cashOnHand, setCashOnHand] = useState<number>(12000);

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + toMonthlyAmount(e), 0),
    [expenses]
  );
  const netCashflow = income - totalExpenses;
  const runway = cashOnHand > 0 && totalExpenses > 0 ? cashOnHand / totalExpenses : 0;
  const isPositive = netCashflow >= 0;

  return (
    <Panel
      title="Monthly Burn Rate"
      icon={<Flame size={16} />}
    >
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Monthly Expenses */}
        <div
          className="rounded-lg p-3 border"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Monthly Expenses</p>
          <p className="text-2xl font-bold text-gray-100">{fmt(totalExpenses)}</p>
        </div>

        {/* Monthly Income */}
        <div
          className="rounded-lg p-3 border"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Monthly Income</p>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={income}
              onChange={(e) => setIncome(Number(e.target.value))}
              className="bg-transparent text-2xl font-bold text-gray-100 w-full outline-none border-b border-gray-600 focus:border-orange-400 transition-colors"
              min={0}
            />
          </div>
        </div>

        {/* Net Cashflow */}
        <div
          className="rounded-lg p-3 border"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Net Cashflow</p>
          <div className="flex items-center gap-2">
            {isPositive
              ? <TrendingUp size={18} className="text-green-400" />
              : <TrendingDown size={18} className="text-red-400" />}
            <p className={`text-2xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {fmt(netCashflow)}
            </p>
          </div>
          <p className={`text-xs mt-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? 'Cash positive' : 'Cash negative'}
          </p>
        </div>

        {/* Runway */}
        <div
          className="rounded-lg p-3 border"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Cash on Hand</p>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={cashOnHand}
              onChange={(e) => setCashOnHand(Number(e.target.value))}
              className="bg-transparent text-lg font-bold text-gray-100 w-full outline-none border-b border-gray-600 focus:border-orange-400 transition-colors"
              min={0}
            />
          </div>
          <p className="text-xs text-orange-300 font-semibold">
            {runway > 0 ? `${runway.toFixed(1)} months runway` : '—'}
          </p>
        </div>
      </div>
    </Panel>
  );
}

// ─── Section 2: Expense Tracker ───────────────────────────────────────────────

function ExpenseTracker({
  expenses,
  onExpensesChange,
}: {
  expenses: Expense[];
  onExpensesChange: (updated: Expense[]) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState<ExpenseCategory>('other');
  const [showAdd, setShowAdd] = useState(false);

  const categoryTotals = useMemo(() => {
    const totals: Record<ExpenseCategory, number> = {
      housing: 0, transport: 0, food: 0, business: 0, other: 0,
    };
    for (const e of expenses) {
      totals[e.category] += toMonthlyAmount(e);
    }
    return totals;
  }, [expenses]);

  function updateAmount(id: string, val: number) {
    onExpensesChange(expenses.map(e => e.id === id ? { ...e, amount: val } : e));
  }

  function removeExpense(id: string) {
    onExpensesChange(expenses.filter(e => e.id !== id));
  }

  function addExpense() {
    if (!newName.trim() || !newAmount) return;
    const newExp: Expense = {
      id: `exp-${Date.now()}`,
      name: newName.trim(),
      amount: parseFloat(newAmount),
      category: newCategory,
      frequency: 'monthly',
    };
    onExpensesChange([...expenses, newExp]);
    setNewName('');
    setNewAmount('');
    setNewCategory('other');
    setShowAdd(false);
  }

  const categories: ExpenseCategory[] = ['housing', 'transport', 'food', 'business', 'other'];

  return (
    <Panel
      title="Expense Tracker"
      icon={<DollarSign size={16} />}
      headerRight={
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors font-semibold uppercase tracking-wide"
        >
          <Plus size={14} /> Add Expense
        </button>
      }
    >
      {/* Add Expense Row */}
      {showAdd && (
        <div
          className="flex flex-wrap gap-2 mb-3 p-3 rounded-lg border"
          style={{ borderColor: '#2a2d38', backgroundColor: '#111318' }}
        >
          <input
            type="text"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="bg-transparent border-b border-gray-600 focus:border-orange-400 outline-none text-sm text-gray-100 px-1 py-0.5 w-32 transition-colors"
          />
          <input
            type="number"
            placeholder="Amount"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            className="bg-transparent border-b border-gray-600 focus:border-orange-400 outline-none text-sm text-gray-100 px-1 py-0.5 w-24 transition-colors"
            min={0}
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as ExpenseCategory)}
            className="bg-gray-900 border border-gray-700 text-sm text-gray-300 rounded px-2 py-0.5 outline-none"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={addExpense}
            className="px-3 py-1 bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold rounded transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => setShowAdd(false)}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Expense List */}
      <div className="space-y-1 mb-4">
        {expenses.map((expense) => (
          <div
            key={expense.id}
            className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors hover:border-gray-600"
            style={{ borderColor: '#1e2128', backgroundColor: '#0a0b10' }}
          >
            <span className="flex-1 text-sm text-gray-200 truncate">{expense.name}</span>
            <CategoryBadge category={expense.category} />
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-xs">$</span>
              <input
                type="number"
                value={expense.amount}
                onChange={(e) => updateAmount(expense.id, Number(e.target.value))}
                className="bg-transparent text-sm font-semibold text-gray-100 w-16 text-right outline-none border-b border-transparent hover:border-gray-600 focus:border-orange-400 transition-colors"
                min={0}
              />
              <span className="text-gray-600 text-xs">/mo</span>
            </div>
            <button
              onClick={() => removeExpense(expense.id)}
              className="text-gray-700 hover:text-red-400 transition-colors ml-1"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Category Totals Footer */}
      <div
        className="flex flex-wrap gap-2 pt-3 border-t"
        style={{ borderColor: '#1e2128' }}
      >
        {categories.map(cat => (
          <div
            key={cat}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs"
            style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
          >
            <CategoryBadge category={cat} />
            <span className="text-gray-300 font-semibold">{fmt(categoryTotals[cat])}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Section 3: Debt Payoff Timeline ─────────────────────────────────────────

interface DebtWithCalc extends DebtItem {
  monthsToPayoff: number;
  payoffDate: string;
  totalInterest: number;
}

function DebtPayoffSection({
  debts,
  netCashflow,
}: {
  debts: DebtItem[];
  netCashflow: number;
}) {
  const [extraPayment, setExtraPayment] = useState<number>(0);

  // Avalanche: sort by interest rate high → low
  const sortedDebts = useMemo(
    () => [...debts].sort((a, b) => b.interestRate - a.interestRate),
    [debts]
  );

  // Available extra cash = positive cashflow + user's extra input
  const availableExtra = useMemo(
    () => Math.max(0, netCashflow) + extraPayment,
    [netCashflow, extraPayment]
  );

  // Cascade avalanche: extra goes to highest-rate first, then moves to next
  const debtsCalc = useMemo((): DebtWithCalc[] => {
    let remainingExtra = availableExtra;

    return sortedDebts.map((debt, idx) => {
      const monthlyRate = debt.interestRate / 100 / 12;
      // Extra payment is applied in avalanche order
      const extra = idx === 0 ? remainingExtra : 0;
      const payment = debt.minimumPayment + extra;
      const months = calcPayoffMonths(debt.balance, monthlyRate, payment);

      // Approximate total interest paid
      const totalPaid = isFinite(months) ? payment * months : Infinity;
      const totalInterest = isFinite(totalPaid) ? Math.max(0, totalPaid - debt.balance) : Infinity;

      // After this debt is cleared, remaining extra moves on
      if (isFinite(months)) {
        remainingExtra += debt.minimumPayment;
      }

      return {
        ...debt,
        monthsToPayoff: months,
        payoffDate: addMonths(months),
        totalInterest,
      };
    });
  }, [sortedDebts, availableExtra]);

  const latestPayoffMonths = useMemo(
    () => Math.max(...debtsCalc.map(d => d.monthsToPayoff).filter(isFinite)),
    [debtsCalc]
  );
  const debtFreeDate = isFinite(latestPayoffMonths) ? addMonths(latestPayoffMonths) : 'N/A';
  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);

  return (
    <Panel
      title="Debt Payoff Timeline"
      icon={<Target size={16} />}
    >
      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div
          className="rounded-lg p-3 border text-center"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Debt</p>
          <p className="text-xl font-bold text-red-400">{fmt(totalBalance)}</p>
        </div>
        <div
          className="rounded-lg p-3 border text-center"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Debt-Free Date</p>
          <p className="text-xl font-bold text-green-400">{debtFreeDate}</p>
        </div>
        <div
          className="rounded-lg p-3 border text-center"
          style={{ borderColor: '#1e2128', backgroundColor: '#111318' }}
        >
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Extra Monthly Payment</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-gray-400 text-sm">$</span>
            <input
              type="number"
              value={extraPayment}
              onChange={(e) => setExtraPayment(Math.max(0, Number(e.target.value)))}
              className="bg-transparent text-xl font-bold text-orange-300 w-20 text-center outline-none border-b border-gray-600 focus:border-orange-400 transition-colors"
              min={0}
            />
          </div>
        </div>
      </div>

      {/* Debt List (Avalanche Order) */}
      <div className="space-y-2">
        {debtsCalc.map((debt, idx) => (
          <div
            key={debt.id}
            className="rounded-lg border p-3"
            style={{ borderColor: '#1e2128', backgroundColor: '#0a0b10' }}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: idx === 0 ? '#f97316' : '#374151' }}
                >
                  {idx + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-100">{debt.name}</p>
                  <p className="text-xs text-gray-500">
                    {debt.interestRate}% APR · Min. {fmt(debt.minimumPayment)}/mo
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-red-400">{fmt(debt.balance)}</p>
                <p className="text-xs text-gray-500">balance</p>
              </div>
            </div>

            {/* Progress & Payoff */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Calendar size={11} />
                <span>Payoff:</span>
                <span className="font-semibold text-green-400">{debt.payoffDate}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <CreditCard size={11} />
                <span>Interest:</span>
                <span className="font-semibold text-yellow-400">
                  {isFinite(debt.totalInterest) ? fmtDecimal(debt.totalInterest) : '—'}
                </span>
              </div>
              {isFinite(debt.monthsToPayoff) && (
                <div className="text-xs text-gray-500">
                  {Math.round(debt.monthsToPayoff)} months
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {isFinite(debt.monthsToPayoff) && (
              <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (1 / (1 + debt.monthsToPayoff / 12)) * 100)}%`,
                    backgroundColor: idx === 0 ? '#f97316' : '#4b5563',
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Avalanche Note */}
      <p className="text-xs text-gray-600 mt-3 text-center italic">
        Avalanche method: extra payments applied to highest-rate debt first
      </p>
    </Panel>
  );
}

// ─── Main DebtKiller View ─────────────────────────────────────────────────────

export default function DebtKiller() {
  // Replace with real Supabase query during integration
  const [expenses, setExpenses] = useState<Expense[]>(mockExpenses);
  // Replace with real Supabase query during integration
  const debts: DebtItem[] = mockDebts;

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + toMonthlyAmount(e), 0),
    [expenses]
  );

  // We pass income from the burn rate section down via shared state
  const [income] = useState<number>(mockMonthlyIncome);
  const netCashflow = income - totalExpenses;

  return (
    <div
      className="min-h-screen p-6"
      style={{ backgroundColor: '#080910', color: '#e5e7eb' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#1a0e05', border: '1px solid #7c2d12' }}
        >
          <Flame size={20} className="text-orange-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-100 tracking-tight">Debt Killer Mode</h1>
          <p className="text-xs text-gray-500">Burn rate · Expense tracker · Payoff timeline</p>
        </div>
      </div>

      {/* 3 Sections */}
      <div className="flex flex-col gap-6 max-w-3xl mx-auto">
        <BurnRateSection expenses={expenses} />
        <ExpenseTracker expenses={expenses} onExpensesChange={setExpenses} />
        <DebtPayoffSection debts={debts} netCashflow={netCashflow} />
      </div>
    </div>
  );
}
