import { fireEvent, screen } from '@testing-library/react';

export function fillCompanyDetails(role = 'MANUFACTURER') {
  for (const [label, value] of [
    ['Registered company name *', 'Cocoa Works'],
    ['Registration number *', 'REG-1'],
    ['Business address *', '1 Supply Road'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.change(screen.getByLabelText('Requested supply-chain role *'), {
    target: { value: role },
  });
}
export function fillContactDetails() {
  for (const [label, value] of [
    ['Company email *', 'hello@example.com'],
    ['Contact number *', '+60123456789'],
    ['Authorised representative *', 'A. Representative'],
    ['Representative position *', 'Director'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
export const continueRegistration = () =>
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
export function goToContactStep() {
  fillCompanyDetails();
  continueRegistration();
}
export function goToWalletStep() {
  goToContactStep();
  fillContactDetails();
  continueRegistration();
}
