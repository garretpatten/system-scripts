import {
  GoogleContactsBackup,
  GoogleContactsBackupConfig,
} from '../../src/google-contacts-backup.js';
import { OTHER_CONTACTS_READ_MASK, PERSON_FIELDS } from '../../src/google-contacts.js';
import { resetExternalDriveMountCache } from '../../src/export-dir.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const CONNECTIONS_URL = `https://people.googleapis.com/v1/people/me/connections?personFields=${encodeURIComponent(PERSON_FIELDS)}&pageSize=1000`;
const CONTACT_GROUPS_URL = 'https://people.googleapis.com/v1/contactGroups?pageSize=1000';
const OTHER_CONTACTS_URL = `https://people.googleapis.com/v1/otherContacts?readMask=${encodeURIComponent(OTHER_CONTACTS_READ_MASK)}&pageSize=1000`;

const CONTACTS = [
  {
    resourceName: 'people/c1',
    names: [{ displayName: 'Alice' }],
    memberships: [{ contactGroupMembership: { contactGroupId: 'contactGroups/1' } }],
  },
  { resourceName: 'people/c2', names: [{ displayName: 'Bob' }] },
];
const CONTACT_GROUPS = [{ resourceName: 'contactGroups/1', formattedName: 'Family' }];
const OTHER_CONTACTS = [{ resourceName: 'people/o1' }];

describe('GoogleContactsBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: GoogleContactsBackupConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive(fs);
    resetExternalDriveMountCache();

    context = {
      logger,
      fs,
      http,
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });

    http.setResponse('POST', 'https://oauth2.googleapis.com/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token' }),
    });

    config = {
      credentials: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
      },
      homeDir: '/home/user',
      logDir: '/logs',
    };
  });

  it('exports contacts, contact groups, and other contacts, then zips them', async () => {
    http.setResponse('GET', CONNECTIONS_URL, {
      statusCode: 200,
      body: JSON.stringify({ connections: CONTACTS }),
    });
    http.setResponse('GET', CONTACT_GROUPS_URL, {
      statusCode: 200,
      body: JSON.stringify({ contactGroups: CONTACT_GROUPS }),
    });
    http.setResponse('GET', OTHER_CONTACTS_URL, {
      statusCode: 200,
      body: JSON.stringify({ otherContacts: OTHER_CONTACTS }),
    });

    await new GoogleContactsBackup(context).run(config);

    const exportDir = '/home/user/Google-Contacts-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/contacts.json`)).toBe(JSON.stringify(CONTACTS, null, 2));
    expect(fs.files.get(`${exportDir}/contact-groups.json`)).toBe(
      JSON.stringify(CONTACT_GROUPS, null, 2),
    );
    expect(fs.files.get(`${exportDir}/other-contacts.json`)).toBe(
      JSON.stringify(OTHER_CONTACTS, null, 2),
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Google-Contacts-Export_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Google-Contacts-Export_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe('/home/user');
    expect(fs.files.get('/home/user/Google-Contacts-Export_2024-06-15.zip')).toBeUndefined();
    expect(
      fs.files.get('/home/user/Exports/Exports_2024-06-15/Google-Contacts-Export_2024-06-15.zip'),
    ).toBe('zip-content');
    expect(logger.messages.some((m) => m.level === 'WARN' && m.message.includes('T7 Shield'))).toBe(
      true,
    );
    expect(logger.messages.some((m) => m.message.includes('Contacts backed up: 2'))).toBe(true);
    expect(logger.messages.some((m) => m.message.includes('Contact groups backed up: 1'))).toBe(
      true,
    );
    expect(logger.messages.some((m) => m.message.includes('Other contacts backed up: 1'))).toBe(
      true,
    );
  });

  it('continues the export when one collection fails', async () => {
    http.setResponse('GET', CONNECTIONS_URL, {
      statusCode: 200,
      body: JSON.stringify({ connections: CONTACTS }),
    });
    http.setResponse('GET', CONTACT_GROUPS_URL, {
      statusCode: 200,
      body: JSON.stringify({ contactGroups: CONTACT_GROUPS }),
    });
    // No response registered for the other-contacts endpoint.

    await new GoogleContactsBackup(context).run(config);

    const exportDir = '/home/user/Google-Contacts-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/other-contacts.json`)).toBeUndefined();
    expect(fs.files.get(`${exportDir}/contacts.json`)).toBe(JSON.stringify(CONTACTS, null, 2));
    expect(
      logger.messages.some(
        (m) => m.level === 'ERROR' && m.message.includes('Failed to export other contacts'),
      ),
    ).toBe(true);
    expect(
      logger.messages.some((m) => m.message.includes('Some collections failed to export')),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(archive.calls).toHaveLength(1);

    process.exitCode = undefined;
  });

  it('skips the zip when every collection fails', async () => {
    // No responses registered for any People API endpoint.

    await new GoogleContactsBackup(context).run(config);

    expect(archive.calls).toHaveLength(0);
    expect(
      fs.files.get('/home/user/Exports/Exports_2024-06-15/Google-Contacts-Export_2024-06-15.zip'),
    ).toBeUndefined();
    expect(
      logger.messages.some((m) => m.message.includes('No collections could be exported')),
    ).toBe(true);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
  });

  it('logs re-authorization guidance on a 403 insufficient-scopes error', async () => {
    const insufficientScopes = JSON.stringify({
      error: { message: 'Request had insufficient authentication scopes.' },
    });
    http.setResponse('GET', CONNECTIONS_URL, { statusCode: 403, body: insufficientScopes });
    http.setResponse('GET', CONTACT_GROUPS_URL, { statusCode: 403, body: insufficientScopes });
    http.setResponse('GET', OTHER_CONTACTS_URL, { statusCode: 403, body: insufficientScopes });

    await new GoogleContactsBackup(context).run(config);

    expect(
      logger.messages.some(
        (m) =>
          m.level === 'ERROR' &&
          m.message.includes('Remove GOOGLE_REFRESH_TOKEN from .env') &&
          m.message.includes('backup:google-contacts'),
      ),
    ).toBe(true);
    expect(archive.calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
  });

  it('throws when Google client credentials are missing', async () => {
    config.credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(new GoogleContactsBackup(context).run(config)).rejects.toThrow(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env',
    );
  });

  it('throws with guidance when only the refresh token is missing', async () => {
    config.credentials = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: '' };

    await expect(new GoogleContactsBackup(context).run(config)).rejects.toThrow(
      'Missing GOOGLE_REFRESH_TOKEN',
    );
  });
});
