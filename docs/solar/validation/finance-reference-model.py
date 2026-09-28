# Independent reference model of engine spec §6 (+ D-05, D-07, D-16, owner Q6/Q7), written
# from the spec formulas, NOT from the TypeScript. 25-year case, debt + tax/12B + replacements.
N = 25
disc, cpi = 0.11, 0.05
capex, inv_capex, batt_capex, q12b = 1_600_000.0, 150_000.0, 450_000.0, 1_150_000.0
kwp = 100
om, ins, mon = 150.0, 0.005, 6_000.0
E1 = 170_000.0
before, after_pv, after = 900_000.0, 650_000.0, 600_000.0
tax_rate = 0.27

def esc(n):  # D-07: 9 % into year 2, linear to 7 % at year 10, then CPI + 1 %
    if n < 2: return 0.0
    if n <= 10: return 0.09 + (0.07 - 0.09) * (n - 2) / 8
    return cpi + 0.01

tf = []
f = 1.0
for n in range(1, N + 1):
    f *= 1 + esc(n); tf.append(f)
deg = [0.98 * 0.995 ** (n - 1) for n in range(1, N + 1)]
def health(n):  # 2 %/yr fade, floor 70 %, replaced at the end of year 10
    age = n - 1 if n <= 10 else n - 11
    return max(0.7, 1 - 0.02 * age)
saving = [((before - after_pv) * deg[n - 1] + (after_pv - after) * health(n)) * tf[n - 1] for n in range(1, N + 1)]
opex = [(om * kwp + capex * ins + mon) * (1 + cpi) ** (n - 1) for n in range(1, N + 1)]
repl = [0.0] * N
repl[11] += 0.6 * inv_capex * (1 + cpi) ** 11   # inverter, year 12
repl[9] += 0.5 * batt_capex * (1 + cpi) ** 9     # battery, year 10
allow = [0.0] * N; allow[0] = q12b               # 12B: ≤ 1 MW → 100 % in year 1

def loan_years(P, rate, term_y):
    i = rate / 12; m = term_y * 12
    pmt = P * i / (1 - (1 + i) ** -m)
    bal = P; out = [[0.0, 0.0] for _ in range(N)]
    for k in range(1, m + 1):
        it = bal * i; pr = pmt - it; bal -= pr
        y = (k - 1) // 12
        out[y][0] += it; out[y][1] += pr
    return out

def metrics(upfront, net):
    flows = [upfront] + net
    npv = lambda r: sum(x / (1 + r) ** t for t, x in enumerate(flows))
    a, b = 0.0, 2.0
    fa = npv(a)
    for _ in range(300):
        m = (a + b) / 2; fm = npv(m)
        if (fm > 0) == (fa > 0): a, fa = m, fm
        else: b = m
    return npv(disc), (a + b) / 2

# cash, tax on
net_cash = []
for n in range(N):
    tax = tax_rate * (saving[n] - opex[n] - allow[n])
    net_cash.append(saving[n] - opex[n] - repl[n] - tax)
npv_c, irr_c = metrics(-capex, net_cash)

# debt 70 %, 11.5 %, 7 years, tax on, interest deductible (Q6)
L = loan_years(0.7 * capex, 0.115, 7)
net_debt = []
for n in range(N):
    it, pr = L[n]
    tax = tax_rate * (saving[n] - opex[n] - allow[n] - it)
    net_debt.append(saving[n] - opex[n] - repl[n] - tax - (it + pr))
npv_d, irr_d = metrics(-(capex - 0.7 * capex), net_debt)

E = [E1 * d for d in deg]
lcoe = (capex + sum((opex[n] + repl[n]) / (1 + disc) ** (n + 1) for n in range(N))) / sum(E[n] / (1 + disc) ** (n + 1) for n in range(N))
print(f"cash NPV {npv_c!r} IRR {irr_c!r}")
print(f"debt NPV {npv_d!r} IRR {irr_d!r}")
print(f"LCOE {lcoe!r}")
print(f"year1 saving {saving[0]!r} year25 saving {saving[24]!r}")
print(f"cash net y1 {net_cash[0]!r} y10 {net_cash[9]!r} y12 {net_cash[11]!r}")
