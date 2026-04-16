import { RegisterSupplierForm } from './RegisterSupplierForm'

export default function SupplierRegisterPage() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white">Join the E-Site Marketplace</h1>
        <p className="text-slate-400 mt-2 text-sm">
          Reach verified electrical contractors across South Africa.
        </p>
      </div>
      <RegisterSupplierForm />
    </div>
  )
}
