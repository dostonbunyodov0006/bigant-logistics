import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ManageableRole } from '@bigant/shared';
import { PageHeader, Tabs } from '../components/ui';
import { UsersManagement } from '../components/UsersManagement';
import { DriversPage } from './DriversPage';
import { OmborchiStaff } from '../components/OmborchiStaff';

// What the address bar says, and what the server calls it. The word in the
// link is the one the office uses; "manager" is still accepted so older links
// and the /managers redirect keep working.
type StaffTab = ManageableRole | 'driver' | 'omborchi';

const PARAM_TO_ROLE: Record<string, StaffTab> = {
  seller: 'seller',
  haydovchi: 'driver',
  dispetcher: 'manager',
  manager: 'manager',
  admin: 'admin',
  omborchi: 'omborchi',
};
const ROLE_TO_PARAM: Record<StaffTab, string> = { seller: 'seller', driver: 'haydovchi', manager: 'dispetcher', admin: 'admin', omborchi: 'omborchi' };

function roleFromParam(value: string | null): StaffTab {
  return PARAM_TO_ROLE[value ?? ''] ?? 'seller';
}

/**
 * Sellers and managers in one screen. They were two sidebar entries rendering
 * the same component with a different role prop, so the role is a tab here.
 *
 * The tab lives in the query string (?role=dispetcher) so a tab is linkable
 * and survives a refresh — the /managers redirect depends on it.
 */
export function StaffPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const role = roleFromParam(params.get('role'));

  return (
    <div>
      <PageHeader
        title={t('team.staffTitle')}
      />

      <Tabs
        active={role}
        onChange={(next) =>
          setParams(next === 'seller' ? {} : { role: ROLE_TO_PARAM[next] }, { replace: true })
        }
        tabs={[
          { value: 'seller', label: t('team.sellersTitle') },
          { value: 'driver', label: t('drivers.title') },
          { value: 'manager', label: t('team.managersTitle') },
          { value: 'admin', label: t('team.adminsTitle') },
          { value: 'omborchi', label: t('team.omborchiTitle') },
        ]}
      />

      {/* Keyed so switching roles resets the search box and page cursor rather
          than carrying a seller search over into the manager list. */}
      {/* Drivers are more than a login — a lorry, a licence, papers — so their
          tab is the full Haydovchilar list, not the plain user table. */}
      {role === 'driver' ? (
        <DriversPage embedded />
      ) : role === 'omborchi' ? (
        <OmborchiStaff />
      ) : (
        <UsersManagement
          key={role}
          role={role}
          onOpen={role === 'seller' ? (u) => navigate(`/sellers/${u.id}`) : undefined}
        />
      )}
    </div>
  );
}
