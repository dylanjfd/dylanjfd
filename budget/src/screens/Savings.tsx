import { Header } from '../components/ui';
import Goals from './Goals';

/** Onglet Épargne : objectifs d'épargne. */
export default function Savings() {
  return (
    <main className="screen">
      <Header title="Épargne" />
      <Goals />
    </main>
  );
}
