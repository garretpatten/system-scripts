import { DateProvider } from './types.js';

export class SystemDateProvider implements DateProvider {
  now(): Date {
    return new Date();
  }
}
