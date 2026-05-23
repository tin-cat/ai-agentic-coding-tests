<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Command\PlaceOrder;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Ordering\Domain\Exception\HoldUnusable;
use Frontstage\Ordering\Domain\Exception\InvalidArgument;
use Frontstage\Ordering\Domain\Model\Order\Order;
use Frontstage\Ordering\Domain\Model\Order\OrderId;
use Frontstage\Ordering\Domain\Model\Order\OrderLine;
use Frontstage\Ordering\Domain\Repository\OrderRepository;
use Frontstage\Ordering\Domain\Service\EventPricing;
use Frontstage\Ordering\Domain\Service\HoldGateway;
use Frontstage\Ordering\Domain\Service\SeatSales;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/**
 * Convert an active hold into a confirmed order.
 *
 * Sequence:
 *
 *   1. Resolve the hold. If it has expired, been released, or already been
 *      consumed, refuse the order — the seats may belong to someone else.
 *   2. Look up each seat's price tier and Money from the Catalog port.
 *   3. Persist the order. Status starts at Placed; the total is computed
 *      from the line items by the aggregate factory.
 *   4. Mark the seats as sold in the source-of-truth inventory.
 *   5. Consume (delete) the hold so the same hold cannot fund a second order.
 *
 * If any single step fails the whole command fails. Step 4 is the only
 * cross-aggregate write so we do it after we have a persisted order to point
 * to; step 5 is idempotent.
 */
#[AsMessageHandler(bus: 'command.bus')]
final class PlaceOrderHandler
{
	public function __construct(
		private readonly OrderRepository $orders,
		private readonly HoldGateway $holds,
		private readonly EventPricing $pricing,
		private readonly SeatSales $sales,
	) {
	}

	public function __invoke(PlaceOrderCommand $command): string
	{
		$orderId = OrderId::fromString($command->orderId);

		$snapshot = $this->holds->findLive($command->holdId);
		if (null === $snapshot) {
			throw HoldUnusable::notLive($command->holdId);
		}

		if ([] === $snapshot->seats) {
			throw new InvalidArgument('Hold carries no seats and cannot become an order.');
		}

		$lines = [];
		foreach ($snapshot->seats as $seat) {
			$price = $this->pricing->priceFor(
				$snapshot->eventId,
				$seat['section'],
				$seat['row'],
				$seat['number'],
			);

			if (null === $price) {
				throw new InvalidArgument(sprintf(
					'Seat "%s/%s/%s" is not part of event "%s".',
					$seat['section'],
					$seat['row'],
					$seat['number'],
					$snapshot->eventId,
				));
			}

			$lines[] = new OrderLine(
				section: $seat['section'],
				row: $seat['row'],
				number: $seat['number'],
				priceTierId: $price->priceTierId,
				price: $price->price,
			);
		}

		$order = Order::place(
			$orderId,
			$snapshot->eventId,
			$snapshot->holdId,
			$lines,
			new DateTimeImmutable('now', new DateTimeZone('UTC')),
		);

		$this->orders->save($order);

		$this->sales->markSold($snapshot->eventId, $snapshot->seats);
		$this->holds->consume($snapshot->holdId);

		return $orderId->toString();
	}
}
