export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">E-Site</h1>
          <p className="text-slate-400 mt-1">Construction management</p>
        </div>
        {children}
      </div>
    </div>
  )
}
