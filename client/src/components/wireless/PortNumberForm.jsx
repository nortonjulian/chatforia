import { useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

export default function PortNumberForm({ onSubmitted }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    phoneNumber: '',
    carrier: '',
    accountNumber: '',
    pin: '',
    fullName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [success, setSuccess] = useState(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await axios.post('/api/porting', form);
      setSuccess(t('wireless.port.success'));
      if (onSubmitted) onSubmitted(res.data);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error ||
          t('wireless.port.genericError')
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.phoneNumberLabel')}
        </label>
        <input
          name="phoneNumber"
          value={form.phoneNumber}
          onChange={handleChange}
          placeholder={t('wireless.port.phoneNumberPlaceholder')}
          className="mt-1 w-full rounded border px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.carrierLabel')}
        </label>
        <input
          name="carrier"
          value={form.carrier}
          onChange={handleChange}
          placeholder={t('wireless.port.carrierPlaceholder')}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">
            {t('wireless.port.accountNumberLabel')}
          </label>
          <input
            name="accountNumber"
            value={form.accountNumber}
            onChange={handleChange}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">
            {t('wireless.port.pinLabel')}
          </label>
          <input
            name="pin"
            value={form.pin}
            onChange={handleChange}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.fullNameLabel')}
        </label>
        <input
          name="fullName"
          value={form.fullName}
          onChange={handleChange}
          className="mt-1 w-full rounded border px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.address1Label')}
        </label>
        <input
          name="addressLine1"
          value={form.addressLine1}
          onChange={handleChange}
          className="mt-1 w-full rounded border px-3 py-2"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.address2Label')}
        </label>
        <input
          name="addressLine2"
          value={form.addressLine2}
          onChange={handleChange}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium">
            {t('wireless.port.cityLabel')}
          </label>
          <input
            name="city"
            value={form.city}
            onChange={handleChange}
            className="mt-1 w-full rounded border px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">
            {t('wireless.port.stateLabel')}
          </label>
          <input
            name="state"
            value={form.state}
            onChange={handleChange}
            className="mt-1 w-full rounded border px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">
            {t('wireless.port.postalCodeLabel')}
          </label>
          <input
            name="postalCode"
            value={form.postalCode}
            onChange={handleChange}
            className="mt-1 w-full rounded border px-3 py-2"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">
          {t('wireless.port.countryLabel')}
        </label>
        <input
          name="country"
          value={form.country}
          onChange={handleChange}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-600">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading
          ? t('wireless.port.submitting')
          : t('wireless.port.submitButton')}
      </button>
    </form>
  );
}
