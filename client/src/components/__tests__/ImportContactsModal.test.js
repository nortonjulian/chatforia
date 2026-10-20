import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ImportContactsModal from '../ImportContactsModal';
import Papa from 'papaparse';
import { importContacts } from '@/api/contacts';

jest.mock('papaparse', () => ({ __esModule: true, default: { parse: jest.fn() } }));
jest.mock('vcard-parser', () => ({ parse: jest.fn(() => []) }));
jest.mock('@/api/contacts', () => ({ importContacts: jest.fn() }));
jest.mock('@/utils/toast', () => ({ toast: { ok: jest.fn() } }));
// Render semantic native controls: these tests exercise selection and async
// import behavior. Mantine appearance is checked in the production build/UI.
jest.mock('@mantine/core', () => {
  const R = require('react');
  const wrap = tag => ({ children }) => R.createElement(tag, null, children);
  const Box = wrap('div');
  const Button = ({ children, onClick, disabled, loading }) => R.createElement('button', {onClick, disabled: disabled || loading}, children);
  const Checkbox = ({indeterminate, ...props}) => R.createElement('input', {type:'checkbox', ...props});
  const FileInput = ({label, onChange, disabled, accept}) => R.createElement('label', null, label,
    R.createElement('input', {type:'file', 'aria-label':label, disabled, accept, onChange:event => onChange(event.target.files[0] || null)}));
  const TextInput = ({label, ...props}) => { delete props.placeholder; return R.createElement('input', {'aria-label':label, ...props}); };
  const Table = wrap('table');
  for (const [key,tag] of Object.entries({Thead:'thead',Tbody:'tbody',Tr:'tr',Th:'th',Td:'td'})) Table[key]=wrap(tag);
  const ScrollArea = {Autosize:Box};
  return {Box,Button,Checkbox,FileInput,TextInput,Table,ScrollArea,Group:Box,Stack:Box,SimpleGrid:Box,
    Text:({children, role, ...props}) => R.createElement('div',{role,'aria-live':props['aria-live']},children),
    Alert:({children}) => R.createElement('div',{role:'alert'},children),
    Modal:({opened,children,title}) => opened ? R.createElement('section',{role:'dialog','aria-label':title},children):null};
});
const csv = [['Name','Phone','Email'],['Alice','111','alice@example.com'],['Bob','222','bob@example.com'],['Carol','333','carol@example.com']];
function chooseCSV() {
  fireEvent.change(screen.getByLabelText('CSV file'), {target:{files:[new File(['csv'], 'contacts.csv', {type:'text/csv'})]}});
}
beforeEach(() => {
  jest.clearAllMocks();
  Papa.parse.mockImplementation((file, options) => options.complete({data:csv,errors:[]}));
  importContacts.mockResolvedValue({added:2,updated:0,skippedDuplicates:0,invalid:0});
});
test('empty preview explains files and disables importing', () => {
  render(<ImportContactsModal opened onClose={jest.fn()} />);
  expect(screen.getByText('Choose a file to preview your contacts')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Import selected'})).toBeDisabled();
  expect(importContacts).not.toHaveBeenCalled();
});
test('filtering preserves original contact selection identity', async () => {
  render(<ImportContactsModal opened onClose={jest.fn()} />); chooseCSV();
  fireEvent.change(screen.getByLabelText('Search preview'), {target:{value:'Bob'}});
  fireEvent.click(screen.getByLabelText('Select Bob (row 2)'));
  fireEvent.change(screen.getByLabelText('Search preview'), {target:{value:''}});
  expect(screen.getByLabelText('Select Alice (row 1)')).toBeChecked();
  expect(screen.getByLabelText('Select Bob (row 2)')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Import selected (2)'}));
  await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1));
  expect(importContacts.mock.calls[0][0].contacts.map(c=>c.name)).toEqual(['Alice','Carol']);
});
test('search does not silently drop selected hidden contacts from the upload', async () => {
  render(<ImportContactsModal opened onClose={jest.fn()} />); chooseCSV();
  fireEvent.change(screen.getByLabelText('Search preview'), {target:{value:'Carol'}});
  fireEvent.click(screen.getByRole('button',{name:'Import selected (3)'}));
  await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1));
  expect(importContacts.mock.calls[0][0].contacts.map(c=>c.name)).toEqual(['Alice','Bob','Carol']);
});
test('bulk selection changes only the matching contacts', () => {
  render(<ImportContactsModal opened onClose={jest.fn()} />); chooseCSV();
  fireEvent.change(screen.getByLabelText('Search preview'), {target:{value:'Bob'}});
  fireEvent.click(screen.getByLabelText('Select all matching contacts'));
  fireEvent.change(screen.getByLabelText('Search preview'), {target:{value:''}});
  expect(screen.getByLabelText('Select Alice (row 1)')).toBeChecked();
  expect(screen.getByLabelText('Select Bob (row 2)')).not.toBeChecked();
  expect(screen.getByLabelText('Select Carol (row 3)')).toBeChecked();
});
test('parse failure is visible and cannot submit a stale preview', () => {
  render(<ImportContactsModal opened onClose={jest.fn()} />); chooseCSV();
  Papa.parse.mockImplementation((file, options) => options.error(new Error('bad file')));
  chooseCSV();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not read this CSV');
  expect(screen.getByRole('button',{name:'Import selected'})).toBeDisabled();
});
test('Cancel never uploads contacts', () => {
  const close=jest.fn(); render(<ImportContactsModal opened onClose={close} />); chooseCSV();
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(close).toHaveBeenCalledTimes(1); expect(importContacts).not.toHaveBeenCalled();
});
test('a closed preview ignores a late file parser callback', () => {
  let complete;
  Papa.parse.mockImplementation((file, options)=> {complete=options.complete;});
  const {rerender}=render(<ImportContactsModal opened onClose={jest.fn()} />); chooseCSV();
  rerender(<ImportContactsModal opened={false} onClose={jest.fn()} />);
  act(()=>complete({data:csv,errors:[]}));
  rerender(<ImportContactsModal opened onClose={jest.fn()} />);
  expect(screen.getByText('Choose a file to preview your contacts')).toBeInTheDocument();
  expect(screen.queryByText('Alice')).not.toBeInTheDocument();
});
test('failed import retains the selection and permits explicit retry', async () => {
  importContacts.mockRejectedValueOnce(new Error('offline'));
  const close=jest.fn(); render(<ImportContactsModal opened onClose={close} />); chooseCSV();
  fireEvent.click(screen.getByRole('button',{name:'Import selected (3)'}));
  await screen.findByRole('alert');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Select Bob (row 2)')).toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Import selected (3)'}));
  await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  expect(importContacts).toHaveBeenCalledTimes(2);
});
