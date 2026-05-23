<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Http;

use Frontstage\Ordering\Domain\Exception\HoldUnusable;
use Frontstage\Ordering\Domain\Exception\InvalidArgument;
use Frontstage\Ordering\Domain\Exception\OrderNotFound;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\Messenger\Exception\HandlerFailedException;

#[AsEventListener]
final class OrderingExceptionListener
{
	public function __invoke(ExceptionEvent $event): void
	{
		$throwable = $event->getThrowable();

		if ($throwable instanceof HandlerFailedException) {
			$nested = $throwable->getPrevious();
			if (null !== $nested) {
				$throwable = $nested;
			}
		}

		$response = match (true) {
			$throwable instanceof OrderNotFound => $this->error(Response::HTTP_NOT_FOUND, $throwable->getMessage()),
			$throwable instanceof InvalidArgument => $this->error(Response::HTTP_BAD_REQUEST, $throwable->getMessage()),
			$throwable instanceof HoldUnusable => $this->error(Response::HTTP_CONFLICT, $throwable->getMessage()),
			default => null,
		};

		if (null !== $response) {
			$event->setResponse($response);
		}
	}

	private function error(int $status, string $message): JsonResponse
	{
		return new JsonResponse(['error' => $message], $status);
	}
}
