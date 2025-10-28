import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { fetchLanguages } from '@/api/languages';

export default function LanguageSelector({ currentLanguage = 'en', onChange }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(currentLanguage);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Keep internal state in sync if parent updates currentLanguage
  useEffect(() => setSelected(currentLanguage), [currentLanguage]);

  // Load language codes from the server
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLanguages()
      .then((list) => {
        if (!cancelled) {
          const safeCodes = Array.isArray(list)
            ? list.map((l) => l.code).filter((code) => typeof code === 'string')
            : [];
          setCodes(safeCodes);
        }
      })
      .catch(() => {
        if (!cancelled) setCodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Localized labels for language codes
  const options = useMemo(() => {
    const makeDN = (loc) => {
      try {
        return new Intl.DisplayNames([loc], { type: 'language' });
      } catch {
        return new Intl.DisplayNames(['en'], { type: 'language' });
      }
    };
    const dn = makeDN(i18n.resolvedLanguage);

    const special = {
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      yue: 'Cantonese',
      ckb: 'Kurdish (Sorani)',
      fil: 'Filipino (Tagalog)',
      'mni-Mtei': 'Meiteilon (Manipuri)',
    };

    const unique = Array.from(new Set([...codes, i18n.resolvedLanguage])).filter(Boolean);
    const list = unique.map((code) => {
      const base = code?.split?.('-')?.[0];
      const label =
        special[code] || dn.of(code) || (base && dn.of(base)) || code || 'Unknown';
      return { value: code, label: capitalize(label) };
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [codes, i18n.resolvedLanguage]);

  // Change language (preload bundle before switching; avoid loops/nulls)
  useEffect(() => {
    if (!selected || selected === i18n.resolvedLanguage) return;
    let cancelled = false;
    i18n
      .loadLanguages(selected)
      .then(() => {
        if (!cancelled) return i18n.changeLanguage(selected);
      })
      .then(() => {
        if (!cancelled) onChange?.(selected);
      })
      .catch((err) => console.error('changeLanguage error', err));
    return () => {
      cancelled = true;
    };
  }, [selected, i18n, onChange]);

  return (
    <Select
      label={t('profile.preferredLanguage')}
      placeholder={t('profile.chooseLanguage')}
      searchable
      clearable={false}
      data={options}
      value={selected}
      onChange={(val) => {
        if (typeof val === 'string' && val) setSelected(val);
      }}
      nothingFoundMessage={t('common.noMatches')}
      radius="md"
      disabled={loading || options.length === 0}
    />
  );
}

LanguageSelector.propTypes = {
  currentLanguage: PropTypes.string,
  onChange: PropTypes.func,
};

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
