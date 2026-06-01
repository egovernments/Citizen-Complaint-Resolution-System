import { Admin, Resource } from 'react-admin';
import { BrowserRouter } from 'react-router-dom';
import { dataProvider } from './dataProvider';
import { TestList, TestShow } from './resources/tests';
import { RunList, RunShow } from './resources/runs';
import { NANO } from './themes';
import Layout from './Layout';
import Dashboard from './Dashboard';

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Admin
        dataProvider={dataProvider}
        title="DIGIT integration tests"
        theme={NANO.light}
        darkTheme={NANO.dark}
        layout={Layout}
        dashboard={Dashboard}
      >
        <Resource name="tests" list={TestList} show={TestShow} recordRepresentation="title" />
        <Resource name="runs" list={RunList} show={RunShow} recordRepresentation="id" />
      </Admin>
    </BrowserRouter>
  );
}
