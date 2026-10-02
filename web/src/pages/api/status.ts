import { endpoint, python } from '../../lib/server';
export const GET = () => endpoint(() => python({ action: 'status' }));
