import {
  GoogleCalendarBackup,
  GoogleCalendarBackupConfig,
} from '../../src/google-calendar-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const CALENDAR_LIST_URL =
  'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250';
const EVENTS_QUERY = 'maxResults=2500&singleEvents=true&orderBy=startTime';

describe('GoogleCalendarBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: GoogleCalendarBackupConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive();

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
      showDeleted: false,
    };
  });

  function mockTwoCalendars(): void {
    http.setResponse('GET', CALENDAR_LIST_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'primary', summary: 'Personal' },
          { id: 'shared@group.calendar.google.com', summary: 'Team/Shared' },
        ],
      }),
    });
    http.setResponse(
      'GET',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${EVENTS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'evt1', summary: 'One' }] }),
      },
    );
    http.setResponse(
      'GET',
      `https://www.googleapis.com/calendar/v3/calendars/shared%40group.calendar.google.com/events?${EVENTS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'evt2', summary: 'Two' }] }),
      },
    );
  }

  it('exports calendar metadata and events, then zips them', async () => {
    mockTwoCalendars();

    await new GoogleCalendarBackup(context).run(config);

    const exportDir = '/home/user/Google-Calendar-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/calendars.json`)).toBe(
      JSON.stringify(
        [
          { id: 'primary', summary: 'Personal' },
          { id: 'shared@group.calendar.google.com', summary: 'Team/Shared' },
        ],
        null,
        2,
      ),
    );
    expect(fs.files.get(`${exportDir}/Personal/calendar.json`)).toBe(
      JSON.stringify({ id: 'primary', summary: 'Personal' }, null, 2),
    );
    expect(fs.files.get(`${exportDir}/Personal/events.json`)).toBe(
      JSON.stringify([{ id: 'evt1', summary: 'One' }], null, 2),
    );
    expect(fs.files.get(`${exportDir}/Team-Shared/events.json`)).toBe(
      JSON.stringify([{ id: 'evt2', summary: 'Two' }], null, 2),
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Google-Calendar-Export_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Google-Calendar-Export_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe('/home/user');
  });

  it('refreshes the access token only once per run', async () => {
    mockTwoCalendars();

    await new GoogleCalendarBackup(context).run(config);

    const tokenRequests = http.requests.filter(
      (request) => request.url === 'https://oauth2.googleapis.com/token',
    );
    expect(tokenRequests).toHaveLength(1);
  });

  it('passes showDeleted to the events endpoint when enabled', async () => {
    config.showDeleted = true;
    http.setResponse('GET', CALENDAR_LIST_URL, {
      statusCode: 200,
      body: JSON.stringify({ items: [{ id: 'primary', summary: 'Personal' }] }),
    });
    http.setResponse(
      'GET',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${EVENTS_QUERY}&showDeleted=true`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [] }),
      },
    );

    await new GoogleCalendarBackup(context).run(config);

    expect(fs.files.get('/home/user/Google-Calendar-Export_2024-06-15/Personal/events.json')).toBe(
      '[]',
    );
  });

  it('continues the export when one calendar fails', async () => {
    http.setResponse('GET', CALENDAR_LIST_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'primary', summary: 'Personal' },
          { id: 'broken', summary: 'Broken' },
        ],
      }),
    });
    http.setResponse(
      'GET',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${EVENTS_QUERY}`,
      {
        statusCode: 200,
        body: JSON.stringify({ items: [{ id: 'evt1', summary: 'One' }] }),
      },
    );

    await new GoogleCalendarBackup(context).run(config);

    const exportDir = '/home/user/Google-Calendar-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/Broken/events.json`)).toBe('[]');
    expect(fs.files.get(`${exportDir}/Personal/events.json`)).toBe(
      JSON.stringify([{ id: 'evt1', summary: 'One' }], null, 2),
    );
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('Failed to export events for calendar'),
      ),
    ).toBe(true);
    expect(archive.calls).toHaveLength(1);
  });

  it('throws when Google credentials are missing', async () => {
    config.credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(new GoogleCalendarBackup(context).run(config)).rejects.toThrow(
      'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in env or .env',
    );
  });
});
