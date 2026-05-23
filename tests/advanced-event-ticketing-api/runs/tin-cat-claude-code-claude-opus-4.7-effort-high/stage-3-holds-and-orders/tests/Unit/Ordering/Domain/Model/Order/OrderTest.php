<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Ordering\Domain\Model\Order;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Ordering\Domain\Exception\InvalidArgument;
use Frontstage\Ordering\Domain\Model\Order\Order;
use Frontstage\Ordering\Domain\Model\Order\OrderId;
use Frontstage\Ordering\Domain\Model\Order\OrderLine;
use Frontstage\Ordering\Domain\Model\Order\OrderStatus;
use Frontstage\Ordering\Domain\Model\Shared\Currency;
use Frontstage\Ordering\Domain\Model\Shared\Money;
use PHPUnit\Framework\TestCase;

final class OrderTest extends TestCase
{
	private function id(): OrderId
	{
		return OrderId::fromString('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
	}

	private function placedAt(): DateTimeImmutable
	{
		return new DateTimeImmutable('2026-01-01T00:00:00+00:00', new DateTimeZone('UTC'));
	}

	public function testPlaceComputesTotalFromLines(): void
	{
		$usd = Currency::of('USD');
		$order = Order::place(
			$this->id(),
			'event-1',
			'hold-1',
			[
				new OrderLine('A', '1', '1', 'vip', Money::of(15000, $usd)),
				new OrderLine('A', '1', '2', 'vip', Money::of(15000, $usd)),
				new OrderLine('B', '1', '1', 'general', Money::of(5000, $usd)),
			],
			$this->placedAt(),
		);

		$this->assertSame(35000, $order->total->amount);
		$this->assertSame('USD', $order->total->currency->code);
		$this->assertSame(OrderStatus::Placed, $order->status);
		$this->assertCount(3, $order->lines());
	}

	public function testPlaceRequiresAtLeastOneLine(): void
	{
		$this->expectException(InvalidArgument::class);
		Order::place($this->id(), 'event-1', 'hold-1', [], $this->placedAt());
	}

	public function testPlaceRejectsDuplicateSeats(): void
	{
		$this->expectException(InvalidArgument::class);
		$usd = Currency::of('USD');
		Order::place(
			$this->id(),
			'event-1',
			'hold-1',
			[
				new OrderLine('A', '1', '1', 'vip', Money::of(15000, $usd)),
				new OrderLine('A', '1', '1', 'vip', Money::of(15000, $usd)),
			],
			$this->placedAt(),
		);
	}

	public function testMoneyAddRejectsMixedCurrencies(): void
	{
		$this->expectException(InvalidArgument::class);
		Money::of(100, Currency::of('USD'))->add(Money::of(100, Currency::of('EUR')));
	}
}
