import {Injectable} from 'angular2/src/core/di';
import {ListWrapper, Map, MapWrapper} from 'angular2/src/core/facade/collection';
import {Serializer} from "angular2/src/web_workers/shared/serializer";
import {isPresent, Type, FunctionWrapper} from "angular2/src/core/facade/lang";
import {MessageBus} from "angular2/src/web_workers/shared/message_bus";
import {
  EventEmitter,
  Promise,
  PromiseWrapper,
  ObservableWrapper
} from 'angular2/src/core/facade/async';

@Injectable()
export class ServiceMessageBrokerFactory {
  /**
   * @private
   */
  constructor(private _messageBus: MessageBus, public _serializer: Serializer) {}

  /**
   * Initializes the given channel and attaches a new {@link ServiceMessageBroker} to it.
   */
  createMessageBroker(channel: string, runInZone: boolean = true): ServiceMessageBroker {
    this._messageBus.initChannel(channel, runInZone);
    return new ServiceMessageBroker(this._messageBus, this._serializer, channel);
  }
}

/**
 * Helper class for UIComponents that allows components to register methods.
 * If a registered method message is received from the broker on the worker,
 * the UIMessageBroker deserializes its arguments and calls the registered method.
 * If that method returns a promise, the UIMessageBroker returns the result to the worker.
 */
export class ServiceMessageBroker {
  private _sink: EventEmitter;
  private _methods: Map<string, Function> = new Map<string, Function>();

  /**
   * @private
   */
  constructor(messageBus: MessageBus, private _serializer: Serializer, public channel) {
    this._sink = messageBus.to(channel);
    var source = messageBus.from(channel);
    ObservableWrapper.subscribe(source, (message) => this._handleMessage(message));
  }

  registerMethod(methodName: string, signature: Type[], method: Function, returnType?: Type): void {
    this._methods.set(methodName, (message: ReceivedMessage) => {
      var serializedArgs = message.args;
      var deserializedArgs: any[] = ListWrapper.createFixedSize(signature.length);
      for (var i = 0; i < signature.length; i++) {
        var serializedArg = serializedArgs[i];
        deserializedArgs[i] = this._serializer.deserialize(serializedArg, signature[i]);
      }

      var promise = FunctionWrapper.apply(method, deserializedArgs);
      if (isPresent(returnType) && isPresent(promise)) {
        this._wrapWebWorkerPromise(message.id, promise, returnType);
      }
    });
  }

  private _handleMessage(map: StringMap<string, any>): void {
    var message = new ReceivedMessage(map);
    if (this._methods.has(message.method)) {
      this._methods.get(message.method)(message);
    }
  }

  private _wrapWebWorkerPromise(id: string, promise: Promise<any>, type: Type): void {
    PromiseWrapper.then(promise, (result: any) => {
      ObservableWrapper.callNext(
          this._sink,
          {'type': 'result', 'value': this._serializer.serialize(result, type), 'id': id});
    });
  }
}

export class ReceivedMessage {
  method: string;
  args: any[];
  id: string;
  type: string;

  constructor(data: StringMap<string, any>) {
    this.method = data['method'];
    this.args = data['args'];
    this.id = data['id'];
    this.type = data['type'];
  }
}
