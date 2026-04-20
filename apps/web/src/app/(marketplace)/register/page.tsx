import { RegisterSupplierForm } from './RegisterSupplierForm'

export default function SupplierRegisterPage() {
  return (
    <div className="animate-fadeup" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="page-header" style={{ textAlign: 'center', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 className="page-title">Join the E-Site Marketplace</h1>
          <p className="page-subtitle">Reach verified electrical contractors across South Africa.</p>
        </div>
      </div>
      <RegisterSupplierForm />
    </div>
  )
}
