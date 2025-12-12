# HTTPServerUE5BlueprintLogging

HTTP Server receives logging from UE5 Blueprint executions

## Blueprint:
<img width="256" height="201" alt="image" src="https://github.com/user-attachments/assets/84445775-be9d-45f2-bce0-6b4cccf4a106" />

### Create CPP Class

<img width="237" height="134" alt="image" src="https://github.com/user-attachments/assets/8439d962-5ad1-4eb5-9384-605a7d4c122d" />

- for this example I used Function Library as parent and expose the function for blueprint purposes then `Next`
<img width="604" height="213" alt="image" src="https://github.com/user-attachments/assets/e06b04c6-5572-468e-8b55-d97160c2a651" />

- Make sure you click public then click `Create Class`
<img width="329" height="93" alt="image" src="https://github.com/user-attachments/assets/2acba2fe-71ca-4b8b-ba96-35373b58beac" />

```cpp
//.h file

UFUNCTION(BlueprintCallable, Category = "SharedSpaces|HTTP")
static void SendLogToServer(const FString& ServerURL, const FString& LogMessage);
```

```cpp
//.cpp file

#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/MessageDialog.h"

void UubcvrFunctionLibrary::SendLogToServer(const FString& ServerURL, const FString& LogMessage)
{
	// Create the HTTP request
	TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(ServerURL);
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));

	// Create the JSON body
	FString JsonString = FString::Printf(TEXT("{\"log\": \"%s\"}"), *LogMessage);
	Request->SetContentAsString(JsonString);

	// Bind the response handler
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr Request, FHttpResponsePtr Response, bool bWasSuccessful)
		{
			if (bWasSuccessful)
			{
				UE_LOG(LogTemp, Log, TEXT("Log successfully sent: %s"), *Response->GetContentAsString());
			}
			else
			{
				UE_LOG(LogTemp, Error, TEXT("Failed to send log"));
			}
		});

	// Send the request
	Request->ProcessRequest();
}
```

in your `Build.cs`
```cs
PublicDependencyModuleNames.AddRange(
	new string[] {
  //... other  dependencies
  "HTTP",
  "Json",
  "JsonUtilities",
});
```

- Better if you close the editor and it in your IDE
- navigate to your http server folder
- open bash or cmd
- run type in: `npm install`
- run your nodejs server type in: `node server.js`





